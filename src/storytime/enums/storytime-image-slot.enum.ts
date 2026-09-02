/**
 * One of the places a Storytime work carries artwork.
 *
 * Named per slot rather than per entity because the entity alone does not say
 * enough: a Story has two images with different shapes and different jobs, and
 * a banner cropped to the profile image's square would be unusable. Everything
 * that differs between them — the aspect ratio, the size a source must reach,
 * the Cloudflare variants it is delivered through — hangs off this.
 */
export enum StorytimeImageSlot {
  /** The wide header across the top of a Story page. */
  STORY_BANNER = 'STORY_BANNER',
  /** The square image identifying a Story in cards and lists. */
  STORY_PROFILE = 'STORY_PROFILE',
  /** The Chapter cover, also used for social previews. */
  CHAPTER_COVER = 'CHAPTER_COVER',
  /** A Character's portrait. */
  CHARACTER_PORTRAIT = 'CHARACTER_PORTRAIT',
  /** The wide header across the top of an Arc page. */
  ARC_BANNER = 'ARC_BANNER',
  /** The square image identifying an Arc in cards and lists. */
  ARC_PROFILE = 'ARC_PROFILE',
  /** Editorial artwork shown instead of the featured work's own banner. */
  SPOTLIGHT_OVERRIDE = 'SPOTLIGHT_OVERRIDE',
}
