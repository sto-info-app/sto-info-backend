export const CLOUDFLARE_IMAGES_DEFAULT_ROOT_URL = 'https://imagedelivery.net';

const CLOUDFLARE_IMAGES_DELIVERY_PATH = 'cdn-cgi/imagedelivery';

/**
 * Resolves the Cloudflare Images delivery root URL from environment variables.
 *
 * @returns The root URL used for Cloudflare Images delivery.
 * Uses `CLOUDFLARE_CDN_ROOT_URL` with `CLOUDFLARE_IMAGES_HASH` when available,
 * otherwise falls back to `https://imagedelivery.net/<hash>`.
 */
export function getCloudflareImagesRootUrl(): string {
  const imagesHash = process.env.CLOUDFLARE_IMAGES_HASH?.trim();
  const cdnRootUrl = process.env.CLOUDFLARE_CDN_ROOT_URL?.trim();

  if (cdnRootUrl && imagesHash) {
    return `${cdnRootUrl}/${CLOUDFLARE_IMAGES_DELIVERY_PATH}/${imagesHash}`;
  }

  return `${CLOUDFLARE_IMAGES_DEFAULT_ROOT_URL}/${imagesHash ?? ''}`;
}

/**
 * Builds a full Cloudflare Images URL from an image UUID and variant name.
 *
 * @param imageUuid - The Cloudflare Images UUID.
 * @param variantName - The Cloudflare Images variant name (for example `public` or `square300`).
 * @throws Error when `imageUuid` or `variantName` is empty after trimming.
 * @returns The full Cloudflare Images URL.
 */
export function buildCloudflareImageUrl(
  imageUuid: string,
  variantName: string,
): string {
  const normalisedImageUuid = imageUuid.trim();
  const normalisedVariantName = variantName.trim();

  if (!normalisedImageUuid) {
    throw new Error('Cloudflare image UUID is required');
  }

  if (!normalisedVariantName) {
    throw new Error('Cloudflare image variant is required');
  }

  return `${getCloudflareImagesRootUrl()}/${normalisedImageUuid}/${normalisedVariantName}`;
}

/**
 * Parsed path components from a Cloudflare Images delivery URL.
 */
type CloudflareImageUrlParts = {
  hash: string;
  imageId: string;
  variant: string;
};

/**
 * Parses Cloudflare Images URL path segments into hash/image/variant parts.
 *
 * @param parsedUrl - Parsed URL instance.
 * @returns Parsed parts when the URL matches supported Cloudflare path formats,
 * otherwise `null`.
 */
function parseCloudflareImageUrlParts(
  parsedUrl: URL,
): CloudflareImageUrlParts | null {
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);

  const isCustomDeliveryPath =
    pathParts.length >= 5 &&
    pathParts[0] === 'cdn-cgi' &&
    pathParts[1] === 'imagedelivery';

  if (isCustomDeliveryPath) {
    return {
      hash: pathParts[2],
      imageId: pathParts[3],
      variant: pathParts[4],
    };
  }

  const cloudflareImagesHost = new URL(CLOUDFLARE_IMAGES_DEFAULT_ROOT_URL)
    .hostname;

  if (parsedUrl.hostname !== cloudflareImagesHost || pathParts.length < 3) {
    return null;
  }

  return {
    hash: pathParts[0],
    imageId: pathParts[1],
    variant: pathParts[2],
  };
}

/**
 * Validates that a custom-domain Cloudflare URL matches configured origin.
 *
 * @param parsedUrl - Parsed URL instance.
 * @returns `true` when the URL origin is compatible with `CLOUDFLARE_CDN_ROOT_URL`.
 */
function isValidCustomOrigin(parsedUrl: URL): boolean {
  const configuredCdnRootUrl = process.env.CLOUDFLARE_CDN_ROOT_URL?.trim();
  if (!configuredCdnRootUrl) {
    return true;
  }

  let configuredOrigin: string;
  try {
    configuredOrigin = new URL(configuredCdnRootUrl).origin;
  } catch {
    return false;
  }

  return parsedUrl.origin === configuredOrigin;
}

/**
 * Validates that a URL is a well-formed Cloudflare Images delivery URL.
 *
 * @param imageUrl - The URL to validate.
 * @returns `true` when the URL matches a supported Cloudflare Images format.
 * Supported formats:
 * 1) `<CLOUDFLARE_CDN_ROOT_URL>/cdn-cgi/imagedelivery/<hash>/<imageId>/<variant>`
 * 2) `https://imagedelivery.net/<hash>/<imageId>/<variant>`
 */
export function isValidCloudflareImageUrl(
  imageUrl?: string | null,
): imageUrl is string {
  if (!imageUrl?.trim()) {
    return false;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    return false;
  }

  if (parsedUrl.protocol !== 'https:') {
    return false;
  }

  const configuredImagesHash = process.env.CLOUDFLARE_IMAGES_HASH?.trim();

  const parts = parseCloudflareImageUrlParts(parsedUrl);
  if (!parts) {
    return false;
  }

  if (!parts.hash || !parts.imageId || !parts.variant) {
    return false;
  }

  const isCustomPath = parsedUrl.pathname.includes('/cdn-cgi/imagedelivery/');
  if (isCustomPath && !isValidCustomOrigin(parsedUrl)) {
    return false;
  }

  if (configuredImagesHash && parts.hash !== configuredImagesHash) {
    return false;
  }

  return true;
}

/**
 * The CDN root in front of Cloudflare, read when asked rather than when this
 * module loads. The env file is read after the entities that build picture
 * URLs have been imported, so a value copied at import time is empty on any
 * run that gets it from the file rather than the process environment.
 *
 * @returns The root URL, or undefined when none is configured.
 */
export function getCloudflareCdnRootUrl(): string | undefined {
  return process.env.CLOUDFLARE_CDN_ROOT_URL?.trim() || undefined;
}

/**
 * The variant a Community, Fleet or Armada banner is delivered at.
 *
 * The full 2400 by 480 a banner has to be uploaded at, so a high-density
 * screen gets the detail it was given. `public` came out 1366 wide, soft at
 * double density, where the banner's 1050 or so pixels need about 2100
 * (18 October 2026). Storytime's banners already use this variant, so it
 * exists on the account.
 */
export const BANNER_VARIANT = 'banner2400x480';

/** The variants a Fleet emblem is drawn at: a listing's row and a page's head. */
export const EMBLEM_VARIANTS = ['square100', 'square300'] as const;

/** An emblem's addresses, by variant. */
export type EmblemImageUrls = Record<(typeof EMBLEM_VARIANTS)[number], string>;

/**
 * The variants a news post's cover is drawn at: its card in a news list, and
 * the head of the post. A single `public` address came out 1366 by 768, more
 * than a card needs and soft across a post at double density (18 October
 * 2026). Storytime's chapter covers already use both, so they exist on the
 * account.
 */
export const COVER_VARIANTS = ['cover640x360', 'cover1920x1080'] as const;

/** A cover's addresses, by variant. */
export type CoverImageUrls = Record<(typeof COVER_VARIANTS)[number], string>;

/**
 * A picture's address, for a response (FC-040). The API signs it on the way
 * out, so the browser never builds one itself.
 *
 * @param imageId - The image, or null.
 * @param variant - The variant.
 * @returns The address, or null when there is no picture.
 */
export function imageUrlOf(
  imageId: string | null | undefined,
  variant: string,
): string | null {
  return imageId ? buildCloudflareImageUrl(imageId, variant) : null;
}

/**
 * A news post cover's addresses at each size the site draws one.
 *
 * @param imageId - The cover, or null.
 * @returns Its addresses by variant, or null when there is no cover.
 */
export function coverUrlsOf(
  imageId: string | null | undefined,
): CoverImageUrls | null {
  return imageId
    ? {
        cover640x360: buildCloudflareImageUrl(imageId, 'cover640x360'),
        cover1920x1080: buildCloudflareImageUrl(imageId, 'cover1920x1080'),
      }
    : null;
}

/**
 * An emblem's addresses at each size the site draws one (FC-040).
 *
 * @param imageId - The emblem, or null.
 * @returns Its addresses by variant, or null when there is no emblem.
 */
export function emblemUrlsOf(
  imageId: string | null | undefined,
): EmblemImageUrls | null {
  return imageId
    ? {
        square100: buildCloudflareImageUrl(imageId, 'square100'),
        square300: buildCloudflareImageUrl(imageId, 'square300'),
      }
    : null;
}
