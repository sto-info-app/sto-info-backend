import { STORYTIME_IMAGE_VARIANTS } from 'src/storytime/constants/storytime-image.constants';

import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';

/**
 * Everything that differs between one custom image shape and another.
 *
 * Deliberately the same shape of description as Storytime's slot
 * specifications, and read by the same validator, so a custom image is held to
 * the checks that already guard every other upload on the site rather than to
 * a second set written for this feature.
 */
export interface CustomTrackingImageSpec {
  /** What the shape is called where a user picks one. */
  readonly label: string;
  /** The shape the source must be cropped to, as width by height. */
  readonly aspectRatio: readonly [number, number];
  /** The narrowest source accepted. */
  readonly minimumWidth: number;
  /** The shortest source accepted. */
  readonly minimumHeight: number;
  /** The width that needs no enlarging anywhere it is shown. */
  readonly recommendedWidth: number;
  /** The height that needs no enlarging anywhere it is shown. */
  readonly recommendedHeight: number;
  /** The encoding the cropped upload must arrive in. */
  readonly outputFormat: 'png' | 'jpeg';
  /** The entity kind recorded against the image in Cloudflare. */
  readonly entityTag: string;
  /** The Cloudflare Images variant the picture is delivered through. */
  readonly variant: string;
}

/**
 * The rules each custom image shape is held to.
 *
 * Every one of these reuses a Cloudflare Images variant that already exists,
 * which is why there are three shapes and not an arbitrary number. A variant
 * name absent from the Cloudflare dashboard yields a broken picture rather
 * than an error anybody would see, so a user-invented shape could not be
 * delivered at all.
 *
 * The minimum accepted size is the delivered size in each case. Storytime's
 * slots accept a range because they feed two variants of different sizes and a
 * creator's artwork is worth taking at whatever quality they have it; a custom
 * image feeds exactly one variant, so anything below it would be enlarged on
 * every page it appears on.
 */
export const CUSTOM_TRACKING_IMAGE_SPECS = {
  SQUARE: {
    label: 'Square image',
    aspectRatio: [1, 1],
    minimumWidth: 300,
    minimumHeight: 300,
    recommendedWidth: 300,
    recommendedHeight: 300,
    outputFormat: 'png',
    entityTag: 'custom-tracking-square',
    variant: STORYTIME_IMAGE_VARIANTS.PROFILE_LARGE,
  },
  LANDSCAPE: {
    label: 'Landscape image',
    aspectRatio: [16, 9],
    minimumWidth: 640,
    minimumHeight: 360,
    recommendedWidth: 640,
    recommendedHeight: 360,
    outputFormat: 'jpeg',
    entityTag: 'custom-tracking-landscape',
    variant: STORYTIME_IMAGE_VARIANTS.COVER_SMALL,
  },
  PORTRAIT: {
    label: 'Portrait image',
    aspectRatio: [2, 3],
    minimumWidth: 400,
    minimumHeight: 600,
    recommendedWidth: 400,
    recommendedHeight: 600,
    outputFormat: 'png',
    entityTag: 'custom-tracking-portrait',
    variant: STORYTIME_IMAGE_VARIANTS.PORTRAIT_LARGE,
  },
} as const satisfies Record<CustomTrackingImageShape, CustomTrackingImageSpec>;

/**
 * One image shape, as the interface offering it needs to know about it.
 *
 * The entity tag is deliberately absent. It is what the picture is filed under
 * in Cloudflare, which is the server's business; everything else here is
 * needed to draw the cropper and to fetch the picture back.
 */
export interface CustomTrackingImageShapeDescription {
  /** The stored identifier. */
  readonly shape: CustomTrackingImageShape;
  /** What the shape is called where a user picks one. */
  readonly label: string;
  /** The width side of the ratio the crop is locked to. */
  readonly aspectWidth: number;
  /** The height side of the ratio the crop is locked to. */
  readonly aspectHeight: number;
  /** The narrowest crop accepted. */
  readonly minimumWidth: number;
  /** The shortest crop accepted. */
  readonly minimumHeight: number;
  /** The encoding the crop must arrive in. */
  readonly outputFormat: 'png' | 'jpeg';
  /** The Cloudflare Images variant the picture is delivered through. */
  readonly variant: string;
}

/**
 * The image shapes, as the interface is told about them.
 *
 * Served rather than compiled into the frontend, for the same reason the
 * limits and the field bounds are. A cropper locked to a ratio the server does
 * not hold the picture to produces an upload that is refused after the user
 * has already chosen and framed it, and a variant name written down twice is
 * one rename away from a broken picture nobody sees an error for.
 */
export const CUSTOM_TRACKING_IMAGE_SHAPES: readonly CustomTrackingImageShapeDescription[] =
  Object.entries(CUSTOM_TRACKING_IMAGE_SPECS).map(([shape, spec]) => ({
    shape: shape as CustomTrackingImageShape,
    label: spec.label,
    aspectWidth: spec.aspectRatio[0],
    aspectHeight: spec.aspectRatio[1],
    minimumWidth: spec.minimumWidth,
    minimumHeight: spec.minimumHeight,
    outputFormat: spec.outputFormat,
    variant: spec.variant,
  }));
