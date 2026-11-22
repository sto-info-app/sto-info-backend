/**
 * What a rename candidate says changed between two consecutive exports.
 *
 * The two shapes plan section 3.6 describes, and the only two the evidence
 * can support. A roster row carries a Character name and an account handle
 * and nothing more permanent, so a rename is recognised by one of the two
 * changing while everything else the row says stays put.
 */
export enum RosterIdentityCandidateKind {
  /**
   * The Character name changed. Same account handle, same unambiguous join
   * instant and the same Class text, one row gone and one row new.
   */
  CHARACTER_RENAME = 'CHARACTER_RENAME',
  /**
   * The account handle changed. Same Character name, join instant and Class
   * text under a different handle. A candidate names the pair of handles and
   * cites every Character that moved between them.
   */
  ACCOUNT_RENAME = 'ACCOUNT_RENAME',
}
