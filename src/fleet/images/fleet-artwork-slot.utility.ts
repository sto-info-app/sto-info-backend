import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { ImageSlotSpec } from 'src/shared/images/image-slot.service';

import { FLEET_IMAGE_SPECS } from '../constants/fleet-image.constants';

/** Which pair of columns one artwork slot writes. */
export interface FleetArtworkColumns {
  /** The column holding the delivery reference. */
  readonly id: 'bannerImageId' | 'emblemImageId';
  /** The column holding what the picture shows. */
  readonly alt: 'bannerImageAlt' | 'emblemImageAlt';
}

/**
 * The columns each slot writes, for the three scope tables alike.
 *
 * One table rather than three, because a Community, a Fleet and an Armada
 * name their artwork identically: the publisher that writes one writes all
 * three, and the only difference between them is which repository it holds.
 *
 * Declared over every {@link FileAssetSlot} as a partial, so a publisher
 * handed a slot no scope has — a `PORTRAIT`, say, from a misrouted
 * placement — finds nothing to write rather than writing to `undefined`.
 */
export const FLEET_ARTWORK_COLUMNS: Partial<
  Record<FileAssetSlot, FleetArtworkColumns>
> = {
  [FileAssetSlot.BANNER]: { id: 'bannerImageId', alt: 'bannerImageAlt' },
  [FileAssetSlot.EMBLEM]: { id: 'emblemImageId', alt: 'emblemImageAlt' },
};

/** The rules each slot's picture is held to. */
export const FLEET_ARTWORK_SPECS: Partial<
  Record<FileAssetSlot, ImageSlotSpec>
> = {
  [FileAssetSlot.BANNER]: FLEET_IMAGE_SPECS.BANNER,
  [FileAssetSlot.EMBLEM]: FLEET_IMAGE_SPECS.EMBLEM,
};

/** The slots a Fleet scope's artwork may occupy. */
export const FLEET_ARTWORK_SLOTS: readonly FileAssetSlot[] = [
  FileAssetSlot.BANNER,
  FileAssetSlot.EMBLEM,
];
