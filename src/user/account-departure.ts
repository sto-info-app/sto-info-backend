/**
 * What becomes of a Community whose Owner closes their account (FC-038).
 */
export interface OwnedCommunityOutcome {
  readonly communityId: string;
  readonly name: string;
  /** Handed to an Admin, or closed because it has none who can take it. */
  readonly outcome: 'TRANSFER' | 'CLOSE';
  /** The Admin it goes to, when it is handed over. */
  readonly toUserId: string | null;
  readonly toUsername: string | null;
}

/**
 * What the account's closure and erasure ask of the Fleet Community, which
 * the user module cannot import without a cycle. The Fleet provides it
 * globally; the user module and the nightly cleanup take it when there.
 */
export interface AccountDeparture {
  /**
   * What would become of each open Community somebody owns.
   *
   * @param userId - The Owner.
   * @returns Each, with its outcome.
   */
  preview(userId: string): Promise<OwnedCommunityOutcome[]>;

  /**
   * Hands each open Community somebody owns to an Admin, or closes it.
   *
   * @param userId - The Owner, closing their account.
   * @returns What became of each.
   */
  depart(userId: string): Promise<OwnedCommunityOutcome[]>;
}

/** The injection token for {@link AccountDeparture}. */
export const ACCOUNT_DEPARTURE = Symbol('ACCOUNT_DEPARTURE');
