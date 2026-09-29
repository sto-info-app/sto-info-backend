import { createHmac } from 'crypto';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { SecretsService } from 'src/shared/secrets/secrets.service';

/** A day, in seconds. */
const DAY_SECONDS = 24 * 60 * 60;

/**
 * When an address signed at a moment expires: the end of the next UTC day
 * (FC-040). Everybody who asks on one day gets the same address, so
 * Cloudflare and browsers can cache it, and none lasts more than two days.
 *
 * @param now - When it is signed.
 * @returns The expiry, in seconds since the epoch.
 */
export function signedImageExpiry(now: Date): number {
  const startOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  return startOfToday / 1000 + 2 * DAY_SECONDS;
}

/**
 * Signs Cloudflare Images delivery addresses (FC-040).
 *
 * A private image is served only to an address carrying `exp` and `sig`,
 * where `sig` is the HMAC-SHA256, in hexadecimal, of
 * `/<account hash>/<image id>/<variant>?exp=<expiry>` under the account's
 * Images signing key. The same signature is accepted on `imagedelivery.net`
 * and on the site's own `/cdn-cgi/imagedelivery/` address: that was proved
 * on the dev account on 29 September 2026, where signing the longer path
 * was refused. A signed address for a public image is served too, so
 * signing can begin before every picture is private.
 *
 * The key is `cloudflareImagesSigningKey` in the application's AWS secret.
 * Without it nothing is signed, uploads stay public and the log says so:
 * the site keeps working as it did before FC-040.
 */
@Injectable()
export class ImageSigningService implements OnModuleInit {
  private readonly _logger = new Logger(ImageSigningService.name);
  private _key: string | null = null;

  /**
   * Creates an instance of ImageSigningService.
   *
   * @param _secrets - The application's secrets.
   */
  constructor(private readonly _secrets: SecretsService) {}

  /**
   * Reads the signing key.
   */
  async onModuleInit(): Promise<void> {
    const secret = (await this._secrets.getSecret(
      process.env.AWS_SECRET_NAME!,
    )) as { cloudflareImagesSigningKey?: unknown } | undefined;
    const key = secret?.cloudflareImagesSigningKey;

    this._key = typeof key === 'string' && key.trim() !== '' ? key : null;

    if (this._key === null) {
      this._logger.warn(
        '[onModuleInit] cloudflareImagesSigningKey is not set: image ' +
          'addresses are not signed and new pictures are uploaded public.',
      );
    }
  }

  /**
   * Whether addresses are signed, and so whether pictures may be private.
   *
   * @returns True once the key is set.
   */
  get enabled(): boolean {
    return this._key !== null;
  }

  /**
   * The signed query for an image and variant.
   *
   * @param hash - The account hash.
   * @param imageId - The image.
   * @param variant - The variant.
   * @param now - When it is signed.
   * @returns `exp=…&sig=…`, or null when there is no key.
   */
  signature(
    hash: string,
    imageId: string,
    variant: string,
    now: Date = new Date(),
  ): string | null {
    if (this._key === null) {
      return null;
    }

    const exp = signedImageExpiry(now);
    const sig = createHmac('sha256', this._key)
      .update(`/${hash}/${imageId}/${variant}?exp=${exp}`)
      .digest('hex');

    return `exp=${exp}&sig=${sig}`;
  }
}
