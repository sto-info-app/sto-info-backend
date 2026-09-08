/**
 * The shape an image Field's picture is cropped to.
 *
 * Three shapes, and no more, because each one has to correspond to a
 * Cloudflare Images variant that already exists in the dashboard. Letting a
 * user invent a shape would produce a reference to a variant nobody had
 * configured, which fails as a broken picture rather than as an error anyone
 * would notice.
 *
 * The shape is part of the Field's definition rather than of each picture, so
 * every Account or Character answering the same Field yields images that line
 * up with one another on the page.
 */
export enum CustomTrackingImageShape {
  /** A square picture, delivered at 300 x 300. */
  SQUARE = 'SQUARE',
  /** A 16:9 picture, delivered at 640 x 360. */
  LANDSCAPE = 'LANDSCAPE',
  /** A 2:3 picture, delivered at 400 x 600. */
  PORTRAIT = 'PORTRAIT',
}
