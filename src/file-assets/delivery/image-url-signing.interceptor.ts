import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { from, Observable, switchMap } from 'rxjs';
import { DataSource, In } from 'typeorm';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { ImageSigningService } from './image-signing.service';

/**
 * The picture shown in place of one that may not be: the site's own "photo
 * unavailable" image, public, in Cloudflare Images.
 */
export const IMAGE_UNAVAILABLE_ID = '817e04f3-331f-4837-e189-c00a68e4c400';

/**
 * The states a picture may be shown in (FC-040): published, or from before
 * the registry and not yet scanned. Steve's decision of 29 September 2026:
 * the estate stays on the site, never marked clean, until FC-041 scans it.
 */
export const SHOWABLE_IMAGE_STATES: readonly FileAssetState[] = [
  FileAssetState.AVAILABLE,
  FileAssetState.UNVERIFIED,
];

/** One Cloudflare Images address in a response. */
interface ImageAddress {
  /** Everything before the account hash, e.g. `https://cdn…/cdn-cgi/imagedelivery`. */
  readonly root: string;
  readonly hash: string;
  readonly imageId: string;
  readonly variant: string;
}

/** The deepest a response is walked; anything deeper is left alone. */
const MAX_DEPTH = 32;

/**
 * Reads a Cloudflare Images address, signed or not.
 *
 * @param value - A string from a response.
 * @param hash - The account hash.
 * @returns Its parts, or null when it is not one.
 */
export function readImageAddress(
  value: string,
  hash: string,
): ImageAddress | null {
  const match =
    /^(https:\/\/[^/\s?#]+(?:\/cdn-cgi\/imagedelivery)?)\/([\w-]+)\/([^/\s?#]+)\/([\w-]+)(?:\?[^\s#]*)?$/.exec(
      value,
    );

  if (match === null || match[2] !== hash) {
    return null;
  }

  const [, root, , imageId, variant] = match;
  const direct = root === 'https://imagedelivery.net';

  if (!direct && !root.endsWith('/cdn-cgi/imagedelivery')) {
    return null;
  }

  return { root, hash, imageId: decodeURIComponent(imageId), variant };
}

/**
 * Signs every picture address the API sends (FC-040).
 *
 * Every response is walked once it is serialised. Each Cloudflare Images
 * address in it is looked up in the registry by its image ID:
 *
 * - a picture that may be shown gets a signed address, the same for
 *   everyone that day;
 * - a picture that may not (revoked, rejected, deleted, or never published)
 *   is replaced by the "photo unavailable" image, so a stale reference
 *   never reaches a browser;
 * - an address the registry does not know is left as it is: the site's own
 *   artwork (icons, the team page, the placeholder itself) lives in
 *   Cloudflare Images too, and it is public.
 *
 * One query for the whole response. Nothing is changed in place: handlers
 * may return cached objects.
 */
@Injectable()
export class ImageUrlSigningInterceptor implements NestInterceptor {
  /**
   * Creates an instance of ImageUrlSigningInterceptor.
   *
   * @param _dataSource - The database.
   * @param _signing - The signer.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _signing: ImageSigningService,
  ) {}

  /**
   * Signs the addresses in a response.
   *
   * @param _context - The request.
   * @param next - The handler.
   * @returns The response, its addresses signed.
   */
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(switchMap(body => from(this.sign(body, new Date()))));
  }

  /**
   * Signs the addresses in a value.
   *
   * @param body - The value.
   * @param now - When.
   * @returns A copy with each address signed or replaced, or the value
   *   itself when it holds none.
   */
  async sign(body: unknown, now: Date): Promise<unknown> {
    const hash = process.env.CLOUDFLARE_IMAGES_HASH?.trim();

    if (!hash || body === null || typeof body !== 'object') {
      return body;
    }

    const found = new Map<string, ImageAddress>();

    collect(body, hash, found, 0);

    if (found.size === 0) {
      return body;
    }

    const imageIds = [
      ...new Set([...found.values()].map(each => each.imageId)),
    ];
    const assets: Pick<FileAssetEntity, 'deliveryReference' | 'state'>[] =
      await this._dataSource.manager.find(FileAssetEntity, {
        where: { deliveryReference: In(imageIds) },
        select: { deliveryReference: true, state: true },
      });
    const states = new Map(
      assets.map(asset => [asset.deliveryReference as string, asset.state]),
    );
    const replacements = new Map<string, string>();

    for (const [value, address] of found) {
      const state = states.get(address.imageId);

      if (state === undefined) {
        continue;
      }

      if (!SHOWABLE_IMAGE_STATES.includes(state)) {
        replacements.set(
          value,
          `${address.root}/${hash}/${IMAGE_UNAVAILABLE_ID}/${address.variant}`,
        );
        continue;
      }

      const signature = this._signing.signature(
        hash,
        address.imageId,
        address.variant,
        now,
      );

      if (signature !== null) {
        replacements.set(
          value,
          `${address.root}/${hash}/${encodeURIComponent(address.imageId)}/${address.variant}?${signature}`,
        );
      }
    }

    return replacements.size === 0 ? body : replace(body, replacements, 0);
  }
}

/**
 * Finds every image address in a value.
 *
 * @param value - The value.
 * @param hash - The account hash.
 * @param found - Where to put them, by the string they were.
 * @param depth - How deep this is.
 */
function collect(
  value: unknown,
  hash: string,
  found: Map<string, ImageAddress>,
  depth: number,
): void {
  if (depth > MAX_DEPTH) {
    return;
  }

  if (typeof value === 'string') {
    if (!found.has(value) && value.includes(hash)) {
      const address = readImageAddress(value, hash);

      if (address !== null) {
        found.set(value, address);
      }
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const each of value) {
      collect(each, hash, found, depth + 1);
    }

    return;
  }

  if (isPlainObject(value)) {
    for (const each of Object.values(value)) {
      collect(each, hash, found, depth + 1);
    }
  }
}

/**
 * Copies a value with some strings replaced.
 *
 * @param value - The value.
 * @param replacements - What each string becomes.
 * @param depth - How deep this is.
 * @returns The copy.
 */
function replace(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) {
    return value;
  }

  if (typeof value === 'string') {
    return replacements.get(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map(each => replace(each, replacements, depth + 1));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, each]) => [
        key,
        replace(each, replacements, depth + 1),
      ]),
    );
  }

  return value;
}

/**
 * Whether a value is a plain object or class instance with own fields, and
 * not a buffer, a stream, a date or anything else to leave alone.
 *
 * @param value - The value.
 * @returns True when it may be walked.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;

  return prototype === Object.prototype || prototype === null;
}
