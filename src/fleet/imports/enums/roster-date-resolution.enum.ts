/**
 * What a date column in a roster export turned out to mean.
 *
 * An export writes wall-clock times with no zone attached, so a date is not
 * an instant until somebody says which clock wrote it — and even then it may
 * name two instants or none. These are the three states a date may be stored
 * in; the fourth possibility, a local time inside a spring-forward gap, is not
 * here because it is refused rather than recorded. Nothing in that hour
 * happened, so there is nothing to keep.
 */
export enum RosterDateResolution {
  /** The column was empty. A legitimate value for every optional date. */
  ABSENT = 'ABSENT',

  /** One instant carries the local time written in the file. */
  EXACT = 'EXACT',

  /**
   * Two instants carry it, because the clock went back over that hour.
   *
   * Both are kept and neither is chosen. Plan section 3.4 is explicit that an
   * ambiguous historical row date keeps its candidates and stays out of exact
   * matching and time claims until something resolves it, rather than being
   * silently read as the earlier one.
   */
  AMBIGUOUS = 'AMBIGUOUS',
}
