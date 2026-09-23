/**
 * Why a cleared roster export is waiting rather than being read.
 *
 * Structural, never content, and shown to whoever sent the file: a hold is
 * something they can act on — by uploading the right export, or by asking
 * somebody who can decide — and one they are not told about looks like a
 * file the site has lost.
 */
export enum RosterHoldReason {
  /**
   * Another export of the Fleet claims the same moment and says something
   * different, and the first version of that moment stays in force until
   * somebody decides which is right.
   */
  EXPORT_INSTANT_IN_CONFLICT = 'EXPORT_INSTANT_IN_CONFLICT',
}
