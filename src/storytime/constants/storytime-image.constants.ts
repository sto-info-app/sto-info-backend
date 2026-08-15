/**
 * Cloudflare Images variant names used by Storytime.
 *
 * These are the exact variant names configured in the Cloudflare dashboard. A
 * variant name that does not exist there yields a broken image rather than an
 * error, so they are declared once here and referenced by the entity URL
 * getters — a dashboard rename is then a one-line change instead of a search
 * across the codebase.
 *
 * `square300` and `square100` predate Storytime and are reused for Story
 * profile images rather than duplicated at the same dimensions.
 */
export const STORYTIME_IMAGE_VARIANTS = {
  /** Story banner, desktop. 2400 x 480. */
  BANNER_LARGE: 'banner2400x480',
  /** Story banner, mobile. 1200 x 240. */
  BANNER_SMALL: 'banner1200x240',
  /** Chapter cover and social preview. 1920 x 1080. */
  COVER_LARGE: 'cover1920x1080',
  /** Chapter card. 640 x 360. */
  COVER_SMALL: 'cover640x360',
  /** Character portrait, 2:3. 400 x 600. */
  PORTRAIT_LARGE: 'portrait400x600',
  /** Character card, 2:3. 133 x 200. */
  PORTRAIT_SMALL: 'portrait133x200',
  /** Story profile image. 300 x 300. */
  PROFILE_LARGE: 'square300',
  /** Story profile image, compact. 100 x 100. */
  PROFILE_SMALL: 'square100',
} as const;

/**
 * The longest alternative text accepted for any Storytime image.
 */
export const STORYTIME_IMAGE_ALT_MAX_LENGTH = 300;
