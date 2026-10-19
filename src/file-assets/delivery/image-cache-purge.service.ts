import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import axios from 'axios';

import {
  DELIVERY_VARIANTS,
  getCloudflareCdnRootUrl,
} from 'src/shared/constants/image.constants';
import { SecretsService } from 'src/shared/secrets/secrets.service';

import { ImageSigningService } from './image-signing.service';

/** A day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The most addresses Cloudflare purges in one request below Enterprise. */
const PURGE_BATCH = 30;

/**
 * Purges a withdrawn picture from the custom domain's edge cache.
 *
 * Deleting an image from Cloudflare Images stops new copies being made, but
 * not the copies the zone's cache already holds: an address fetched before
 * the withdrawal went on being served from the edge until its cache lifetime
 * ran out, up to the end of the next day (found on tribble, 19 October 2026).
 * `imagedelivery.net` is not affected; it answered 404 straight after the
 * delete.
 *
 * The addresses can be worked out exactly. Every variant is served signed for
 * yesterday's expiry or today's, since an address expires at the end of the
 * day after it was signed, and unsigned for a picture from before signing.
 * Each is purged by its exact address.
 *
 * The zone and a token allowed only to purge its cache are
 * `cloudflareZoneId` and `cloudflareCachePurgeToken` in the application's AWS
 * secret. Without them nothing is purged and the log says so, as signing
 * does without its key.
 */
@Injectable()
export class ImageCachePurgeService implements OnModuleInit {
  private readonly _logger = new Logger(ImageCachePurgeService.name);
  private _zoneId: string | null = null;
  private _token: string | null = null;

  /**
   * Creates an instance of ImageCachePurgeService.
   *
   * @param _secrets - The application's secrets.
   * @param _signing - Signs the addresses to purge.
   */
  constructor(
    private readonly _secrets: SecretsService,
    private readonly _signing: ImageSigningService,
  ) {}

  /**
   * Reads the zone and the purge token.
   */
  async onModuleInit(): Promise<void> {
    const secret = (await this._secrets.getSecret(
      process.env.AWS_SECRET_NAME!,
    )) as
      | { cloudflareZoneId?: unknown; cloudflareCachePurgeToken?: unknown }
      | undefined;

    this._zoneId = filled(secret?.cloudflareZoneId);
    this._token = filled(secret?.cloudflareCachePurgeToken);

    if (!this.enabled) {
      this._logger.warn(
        '[onModuleInit] cloudflareZoneId or cloudflareCachePurgeToken is ' +
          'not set: a withdrawn picture is not purged from the edge cache.',
      );
    }
  }

  /**
   * Whether the edge cache can be purged.
   *
   * @returns True once the zone and token are set.
   */
  get enabled(): boolean {
    return this._zoneId !== null && this._token !== null;
  }

  /**
   * Every custom-domain address a picture may be cached at.
   *
   * @param imageId - The Cloudflare Images identifier.
   * @param now - When the picture is withdrawn.
   * @returns The addresses, or none when the domain is not configured.
   */
  addressesOf(imageId: string, now: Date = new Date()): string[] {
    const root = getCloudflareCdnRootUrl();
    const hash = process.env.CLOUDFLARE_IMAGES_HASH?.trim();

    if (!root || !hash) {
      return [];
    }

    const yesterday = new Date(now.getTime() - DAY_MS);

    return DELIVERY_VARIANTS.flatMap(variant => {
      const address = `${root}/cdn-cgi/imagedelivery/${hash}/${imageId}/${variant}`;
      const signed = [now, yesterday]
        .map(moment => this._signing.signature(hash, imageId, variant, moment))
        .filter((query): query is string => query !== null)
        .map(query => `${address}?${query}`);

      return [address, ...signed];
    });
  }

  /**
   * Purges every address a picture may be cached at, reporting rather than
   * throwing.
   *
   * @param imageId - The Cloudflare Images identifier.
   * @returns True when Cloudflare purged them all, or there was nothing it
   *   could purge.
   */
  async purge(imageId: string): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }

    const addresses = this.addressesOf(imageId);

    try {
      for (let start = 0; start < addresses.length; start += PURGE_BATCH) {
        await axios.post(
          `https://api.cloudflare.com/client/v4/zones/${this._zoneId}/purge_cache`,
          { files: addresses.slice(start, start + PURGE_BATCH) },
          { headers: { Authorization: `Bearer ${this._token}` } },
        );
      }

      return true;
    } catch (error: unknown) {
      this._logger.error(
        `[purge] Edge cache not purged - ImageId: ${imageId}, ` +
          `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return false;
    }
  }
}

/**
 * A secret's value, when it is a string with something in it.
 *
 * @param value - The value read.
 * @returns The value, or null.
 */
function filled(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
