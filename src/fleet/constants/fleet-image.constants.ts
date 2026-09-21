import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { ImageSlotSpec } from 'src/shared/images/image-slot.service';

/**
 * The pictures a Community, Fleet or Armada may carry.
 *
 * **Nothing uploads one yet.** FC-012 built the ingress every picture on the
 * site now goes through and wrote these specifications with it; the routes
 * that use them arrive with FC-013 and the registration screens. They are
 * here rather than there because the shape of a Fleet banner is a property
 * of the design — ADR-0014's one colour and shared components — and not of
 * whichever ticket happens to add the form.
 *
 * The two shapes match the ones Storytime already uses for the same jobs. A
 * reader who has cropped a Story banner should not have to learn a second
 * set of dimensions to crop a Fleet one, and the LCARS strip that reports a
 * scan is the same component in both places.
 */
export const FLEET_IMAGE_SPECS: Readonly<
  Record<'BANNER' | 'EMBLEM', ImageSlotSpec>
> = {
  /** The wide header across the top of a scope's page. */
  BANNER: {
    label: 'Fleet banner',
    aspectRatio: [5, 1],
    minimumWidth: 2400,
    minimumHeight: 480,
    recommendedWidth: 2400,
    recommendedHeight: 480,
    outputFormat: 'jpeg',
    entityTag: 'fleet-banner',
  },
  /** The square badge identifying a scope in a listing. */
  EMBLEM: {
    label: 'Fleet emblem',
    aspectRatio: [1, 1],
    minimumWidth: 300,
    minimumHeight: 300,
    recommendedWidth: 512,
    recommendedHeight: 512,
    outputFormat: 'png',
    entityTag: 'fleet-emblem',
  },
};

/**
 * Which registry subject each kind of Fleet scope is.
 *
 * Three subjects rather than one, because the three are three tables and a
 * publisher writes a table. The slot is {@link FileAssetSlot.BANNER} or
 * {@link FileAssetSlot.EMBLEM} in every case.
 */
export const FLEET_IMAGE_SUBJECTS = {
  /** A registered Community. */
  COMMUNITY: FileAssetSubject.FLEET_COMMUNITY,
  /** A registered Fleet. */
  FLEET: FileAssetSubject.FLEET,
  /** A registered Armada. */
  ARMADA: FileAssetSubject.ARMADA,
} as const;

/** The slots a Fleet scope's pictures occupy. */
export const FLEET_IMAGE_SLOTS = {
  /** The wide header. */
  BANNER: FileAssetSlot.BANNER,
  /** The square badge. */
  EMBLEM: FileAssetSlot.EMBLEM,
} as const;

/**
 * The longest description a banner or an emblem may carry.
 *
 * The same 300 characters Storytime allows, and the same length the columns
 * hold. Long enough to say what a picture shows, short enough that a
 * description is a description rather than a second body of text nobody
 * reads out.
 */
export const FLEET_IMAGE_ALT_MAX_LENGTH = 300;
