import { ImageSlotSpec } from 'src/shared/images/image-slot.service';

/**
 * The two kinds of Captain's Log entry (sc-1450).
 *
 * A Captain's entry is shown on its author's profile while the profile is
 * public; a Personal entry is only ever shown to its author.
 */
export enum LogEntryType {
  CAPTAIN = 'CAPTAIN',
  PERSONAL = 'PERSONAL',
}

/** The longest headline an entry may have. */
export const LOG_HEADLINE_MAX_LENGTH = 120;

/** The longest body an entry may have, in Markdown. */
export const LOG_BODY_MAX_LENGTH = 10000;

/** The longest reason a site admin may give for removing an entry. */
export const LOG_REMOVAL_REASON_MAX_LENGTH = 500;

/** How many entries a page holds unless asked for another number. */
export const LOG_DEFAULT_PAGE_SIZE = 20;

/**
 * The picture an entry may carry: the shape and sizes of a news cover,
 * delivered through the same Cloudflare variants and recorded there as a
 * Log picture.
 */
export const LOG_PICTURE_SPEC: ImageSlotSpec = {
  label: 'Log picture',
  aspectRatio: [16, 9],
  minimumWidth: 640,
  minimumHeight: 360,
  recommendedWidth: 1920,
  recommendedHeight: 1080,
  outputFormat: 'jpeg',
  entityTag: 'log-picture',
};

/** What the size limit is called when an upload is too large. */
export const LOG_PICTURE_SIZE_LABEL = 'Log pictures';

/** Where an entry's author finds their Log, for a notification's link. */
export const LOG_LINK = '/dashboard/log';
