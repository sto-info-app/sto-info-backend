import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';

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

/**
 * Everything that differs between one artwork slot and another.
 */
export interface StorytimeImageSpec {
  /** What the slot is called where a creator is asked to fill it. */
  readonly label: string;
  /** The shape the source must be cropped to, as width by height. */
  readonly aspectRatio: readonly [number, number];
  /** The narrowest source accepted, matching the largest variant it feeds. */
  readonly minimumWidth: number;
  /** The shortest source accepted, matching the largest variant it feeds. */
  readonly minimumHeight: number;
  /** The encoding the cropped upload must arrive in. */
  readonly outputFormat: 'png' | 'jpeg';
  /** The entity kind recorded against the image in Cloudflare. */
  readonly entityTag: string;
}

/**
 * The rules each artwork slot is held to.
 *
 * The minimums are the dimensions of the largest Cloudflare variant the slot
 * feeds, so nothing is ever upscaled: a banner that reaches a reader at
 * 2400 x 480 is refused below that rather than delivered soft. They are read
 * by the upload validator and served to the editor, so the size a creator is
 * asked for and the size the server insists on cannot drift apart.
 *
 * The wide slots are encoded as JPEG. A photographic 2400 x 480 banner as PNG
 * runs to several megabytes of losslessly-stored noise before it reaches the
 * size check; the square and portrait slots stay PNG, where the saving is
 * small and flat artwork is common.
 */
export const STORYTIME_IMAGE_SPECS = {
  STORY_BANNER: {
    label: 'Story banner',
    aspectRatio: [5, 1],
    minimumWidth: 2400,
    minimumHeight: 480,
    outputFormat: 'jpeg',
    entityTag: 'storytime-story-banner',
  },
  STORY_PROFILE: {
    label: 'Story profile image',
    aspectRatio: [1, 1],
    minimumWidth: 300,
    minimumHeight: 300,
    outputFormat: 'png',
    entityTag: 'storytime-story-profile',
  },
  CHAPTER_COVER: {
    label: 'Chapter cover',
    aspectRatio: [16, 9],
    minimumWidth: 1920,
    minimumHeight: 1080,
    outputFormat: 'jpeg',
    entityTag: 'storytime-chapter-cover',
  },
  CHARACTER_PORTRAIT: {
    label: 'Character portrait',
    aspectRatio: [2, 3],
    minimumWidth: 400,
    minimumHeight: 600,
    outputFormat: 'png',
    entityTag: 'storytime-character-portrait',
  },
  ARC_BANNER: {
    label: 'Arc banner',
    aspectRatio: [5, 1],
    minimumWidth: 2400,
    minimumHeight: 480,
    outputFormat: 'jpeg',
    entityTag: 'storytime-arc-banner',
  },
  ARC_PROFILE: {
    label: 'Arc profile image',
    aspectRatio: [1, 1],
    minimumWidth: 300,
    minimumHeight: 300,
    outputFormat: 'png',
    entityTag: 'storytime-arc-profile',
  },
  SPOTLIGHT_OVERRIDE: {
    label: 'Spotlight artwork',
    aspectRatio: [5, 1],
    minimumWidth: 2400,
    minimumHeight: 480,
    outputFormat: 'jpeg',
    entityTag: 'storytime-spotlight-override',
  },
} as const satisfies Record<StorytimeImageSlot, StorytimeImageSpec>;

/**
 * How far a crop may drift from its slot's exact aspect ratio.
 *
 * A browser crop lands on whole pixels, so a 5:1 banner arrives as 2401 x 480
 * as often as 2400 x 480. Insisting on the exact ratio would refuse crops that
 * are visually identical to the ones it accepts; one per cent is wide enough
 * to cover the rounding and far too narrow to let a square through as a
 * banner.
 */
export const STORYTIME_IMAGE_ASPECT_TOLERANCE = 0.01;
