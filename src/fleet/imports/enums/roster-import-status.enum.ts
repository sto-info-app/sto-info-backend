/**
 * Where a roster import has got to, in the words the person who sent it
 * would use.
 *
 * Derived rather than stored. Two records already hold the truth between
 * them: the file asset says what the scanner made of the bytes, and the
 * placement says what publication made of the import. Storing a third copy
 * would give the three of them a way to disagree. The derivation is
 * {@link RosterImportStatusService}'s, and it is the only one.
 *
 * Every import that is read into observations ends `IMPORTED`, and stays so
 * when a later export arrives. Which snapshot is the latest is a question for
 * history and reports; this answers only what became of one upload.
 */
export enum RosterImportStatus {
  /** The file is waiting for a scanner, or a scanner has it. */
  SCANNING = 'SCANNING',

  /** A scanner has cleared it, and it is being read into observations. */
  PUBLISHING = 'PUBLISHING',

  /** It was read into observations. */
  IMPORTED = 'IMPORTED',

  /**
   * Cleared and readable, and waiting for somebody to decide about it — so
   * far only because another export of the Fleet claims the same moment and
   * says something different.
   */
  HELD = 'HELD',

  /** Refused, by the scanner or because its rows could not be read. */
  REFUSED = 'REFUSED',

  /**
   * Nothing will happen to it now: no verdict ever came back, and the file
   * has been given up on.
   */
  ABANDONED = 'ABANDONED',
  /**
   * It was held, and its file was deleted at the end of its retention before
   * anybody selected it, so it can no longer be selected (FC-037).
   */
  EXPIRED = 'EXPIRED',
  /**
   * It was held, and its file was deleted by a verified erasure of somebody
   * it named before anybody selected it, so it can no longer be (FC-038).
   */
  ERASED = 'ERASED',
}
