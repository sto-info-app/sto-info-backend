/**
 * Where a Fleet's request to join an Armada stands (FC-025).
 */
export enum ArmadaJoinRequestStatus {
  /** Waiting for an Armada manager, until it lapses. */
  PENDING = 'PENDING',
  /** Approved: the Fleet was placed. */
  APPROVED = 'APPROVED',
  /** Rejected, with a reason the requesting Fleet is shown. */
  REJECTED = 'REJECTED',
  /** Taken back by the requesting Fleet. */
  WITHDRAWN = 'WITHDRAWN',
  /** Left unanswered for fourteen days. */
  LAPSED = 'LAPSED',
  /** Ended because the Armada closed. */
  CANCELLED = 'CANCELLED',
}
