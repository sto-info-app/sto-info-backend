/**
 * What has become of a proposal that a Character belongs to a Fleet.
 *
 * Three of the four values are something a person did. There is no `EXPIRED`
 * here on purpose: nobody expires a proposal, time does, and a status column
 * that has to be swept by a job is wrong between the moment it lapses and the
 * moment the job next runs. Expiry is read from `expiresAt` instead — see
 * {@link CharacterFleetProposalState}, which is what a client is told and
 * does carry an expired value.
 *
 * The fourth, `LAPSED`, is the one exception, added by FC-018 and kept as
 * narrow as it can be: see its own note.
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
  /**
   * It expired unanswered and a later import asked again.
   *
   * The only status the site writes rather than a person, and only in that
   * one moment: the unique index allows one `PENDING` proposal per Character
   * and Fleet, so an expired one has to stop being `PENDING` for its
   * replacement to exist. The replacement names it in `replacesProposalId`.
   * A lapsed proposal was already expired, so it reads as
   * {@link CharacterFleetProposalState.EXPIRED} and nothing a client sees
   * changes; Steve's decision of 24 September 2026.
   */
  LAPSED = 'LAPSED',
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
