import { Injectable } from '@nestjs/common';

import { ImageSigningService } from './image-signing.service';
import { readImageAddress } from './image-url-signing.interceptor';

/** How long after it expired an address may still be renewed: a day. */
export const RENEWABLE_FOR_MS = 24 * 60 * 60 * 1000;

/** The most addresses one request may renew. */
export const MAX_RENEWED_ADDRESSES = 50;

/**
 * Renews the signed picture addresses of a page left open.
 *
 * A signed address lasts at most two hours, so a page open longer than that
 * can redraw a picture at an address Cloudflare now refuses. The browser
 * sends it here, and gets back the same picture's address unsigned, for
 * `ImageUrlSigningInterceptor` to sign or replace as it does every address
 * in every response: signed again while the picture may be shown, the
 * "photo unavailable" picture once it may not.
 *
 * Only an address the API signed itself is renewed, and only until a day
 * after it expired. So a picture reachable only by its address cannot be
 * found by guessing an image ID, and an address copied off the site cannot
 * be kept alive for good.
 */
@Injectable()
export class ImageAddressRenewalService {
  /**
   * Creates an instance of ImageAddressRenewalService.
   *
   * @param _signing - The signer, which checks the old signature.
   */
  constructor(private readonly _signing: ImageSigningService) {}

  /**
   * Renews addresses.
   *
   * @param addresses - The addresses the browser could not load.
   * @param now - When.
   * @returns For each, in order, its picture's unsigned address, or null
   *   when it may not be renewed.
   */
  renew(
    addresses: readonly string[],
    now: Date = new Date(),
  ): (string | null)[] {
    const hash = process.env.CLOUDFLARE_IMAGES_HASH?.trim();

    return addresses.map(value =>
      hash ? this.renewOne(value, hash, now) : null,
    );
  }

  /**
   * Renews one address.
   *
   * @param value - The address.
   * @param hash - The account hash.
   * @param now - When.
   * @returns Its picture's unsigned address, or null.
   */
  private renewOne(value: string, hash: string, now: Date): string | null {
    const address = readImageAddress(value, hash);

    if (address === null) {
      return null;
    }

    const query = new URL(value).searchParams;
    const exp = query.get('exp');
    const sig = query.get('sig');

    if (
      exp === null ||
      sig === null ||
      Number(exp) * 1000 < now.getTime() - RENEWABLE_FOR_MS ||
      !this._signing.isGenuine(hash, address.imageId, address.variant, exp, sig)
    ) {
      return null;
    }

    return `${address.root}/${hash}/${encodeURIComponent(address.imageId)}/${address.variant}`;
  }
}
