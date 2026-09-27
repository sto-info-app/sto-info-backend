/**
 * Where an offer of a Community's ownership stands (FC-022).
 *
 * An offer lapses seven days after it is made. That is read from its
 * `expiresAt` rather than kept as a status, as an invitation's is: `LAPSED`
 * is written only when a newer offer replaces an expired one, which frees the
 * one-open-offer slot the new one needs.
 */
export enum OwnershipTransferStatus {
  /** Made, and not yet answered. Open until `expiresAt`. */
  PENDING = 'PENDING',
  /** The Admin accepted, and is now the Owner. */
  ACCEPTED = 'ACCEPTED',
  /** The Admin said no. */
  DECLINED = 'DECLINED',
  /**
   * Taken back before it was answered: by the Owner, or because the offer
   * could no longer be kept — the Admin lost the role, the Community closed,
   * or a site administrator moved ownership.
   */
  CANCELLED = 'CANCELLED',
  /** It expired unanswered and a newer offer replaced it. */
  LAPSED = 'LAPSED',
}

/**
 * Where an offer stands, the clock included.
 *
 * The stored status widened by the one thing the clock decides, so no reader
 * has to compare a deadline itself.
 */
export enum OwnershipTransferState {
  /** Unanswered and still answerable. */
  PENDING = 'PENDING',
  /** Accepted. */
  ACCEPTED = 'ACCEPTED',
  /** Declined. */
  DECLINED = 'DECLINED',
  /** Taken back. */
  CANCELLED = 'CANCELLED',
  /** Never answered, and too late to answer now. */
  EXPIRED = 'EXPIRED',
}
