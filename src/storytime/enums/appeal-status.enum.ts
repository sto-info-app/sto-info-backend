/**
 * Where a creator's appeal against a removal has got to.
 *
 * A creator may hold one live appeal per removed item. Withdrawing an appeal
 * frees them to submit a fresh one; an upheld or rejected appeal does not.
 */
export enum AppealStatus {
  /** Awaiting administrator review. */
  SUBMITTED = 'SUBMITTED',
  /** Accepted; the removal was reversed. */
  UPHELD = 'UPHELD',
  /** Refused; the removal stands. */
  REJECTED = 'REJECTED',
  /** Taken back by the creator before it was decided. */
  WITHDRAWN = 'WITHDRAWN',
}
