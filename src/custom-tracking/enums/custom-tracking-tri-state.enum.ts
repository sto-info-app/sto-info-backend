/**
 * The answer a Yes/No/Unknown Field holds.
 *
 * `UNKNOWN` is a real answer and is not the same as leaving the Field empty. A
 * user recording whether a Character has finished a mission may genuinely know
 * that they do not know, and that is worth writing down; an empty Field means
 * only that nobody has looked yet.
 */
export enum CustomTrackingTriState {
  /** Yes. */
  YES = 'YES',
  /** No. */
  NO = 'NO',
  /** Deliberately recorded as not known. */
  UNKNOWN = 'UNKNOWN',
}
