/**
 * Why a rename candidate cannot be resolved.
 *
 * A candidate with any of these is recorded so a reviewer can see it, and can
 * be neither confirmed nor rejected: the evidence fits more than one reading,
 * and choosing one would be the join-date-or-name-alone merge FC-018 exists to
 * refuse. It stays open until different evidence arrives.
 */
export enum RosterIdentityCollisionReason {
  /**
   * One of the two rows fits more than one row on the other side, so the pair
   * is not unique both ways.
   */
  SEVERAL_PARTNERS = 'SEVERAL_PARTNERS',
  /**
   * The old handle is still in the later export under another Character. A
   * handle belongs to the whole account, so an account that was renamed
   * cannot still be using its old one.
   */
  OLD_HANDLE_STILL_PRESENT = 'OLD_HANDLE_STILL_PRESENT',
  /**
   * The new handle was already in the earlier export under another
   * Character, so it cannot be a name the account has only just taken.
   */
  NEW_HANDLE_ALREADY_PRESENT = 'NEW_HANDLE_ALREADY_PRESENT',
  /** The old handle's Characters moved to more than one new handle. */
  HANDLE_SPLIT = 'HANDLE_SPLIT',
  /** More than one old handle's Characters moved to the same new handle. */
  HANDLE_MERGE = 'HANDLE_MERGE',
}
