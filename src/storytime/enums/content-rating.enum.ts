/**
 * The audience a Story is suitable for.
 *
 * Modelled as an enum rather than a lookup table because the three ratings are
 * fixed by product decision and are referenced directly by rendering logic; a
 * lookup table would add a join and a failure mode for no benefit.
 *
 * None of these gate access. `MATURE` shows a warning banner and a listing
 * icon, and `ADULTS_ONLY` a stronger warning, but neither requires an
 * acknowledgement. Explicit images and video remain prohibited by the site
 * terms whatever the rating.
 */
export enum ContentRating {
  /** May contain moderate violence, suggestive references or occasional strong language. */
  GENERAL = 'GENERAL',
  /** Intense violence, heavy or explicit themes, substance use, or strong profanity. */
  MATURE = 'MATURE',
  /** Explicit sexual content, graphic violence, or extreme elements, restricted to adults. */
  ADULTS_ONLY = 'ADULTS_ONLY',
}
