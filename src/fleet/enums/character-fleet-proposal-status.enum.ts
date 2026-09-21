/**
 * What has become of a proposal that a Character belongs to a Fleet.
 *
 * Three values, and every one of them is something a person did. There is no
 * `EXPIRED` here on purpose: nobody expires a proposal, time does, and a
 * status column that has to be swept by a job is wrong between the moment it
 * lapses and the moment the job next runs. Expiry is read from `expiresAt`
 * instead — see {@link CharacterFleetProposalState}, which is what a client is
 * told and does carry an expired value.
 *
 * `PENDING` is the only status the unique index counts, so a Fleet may hold at
 * most one unanswered proposal for a Character at a time while other Fleets
 * hold their own — FC-014 keeps competing proposals independently answerable.
 */
export enum CharacterFleetProposalStatus {
  /** Raised and not yet answered. */
  PENDING = 'PENDING',
  /** The Character's owner accepted it, and a membership records that. */
  ACCEPTED = 'ACCEPTED',
  /** The Character's owner said no. */
  DECLINED = 'DECLINED',
}

/**
 * What a client is told about a proposal.
 *
 * The stored status widened by the one thing the clock decides. A pending
 * proposal past its `expiresAt` reads as `EXPIRED` everywhere, and answering
 * one is refused, so no reader has to know to compare a date itself.
 */
export enum CharacterFleetProposalState {
  /** Unanswered and still answerable. */
  PENDING = 'PENDING',
  /** Accepted by the owner. */
  ACCEPTED = 'ACCEPTED',
  /** Declined by the owner. */
  DECLINED = 'DECLINED',
  /** Never answered, and too late to answer now. */
  EXPIRED = 'EXPIRED',
}
