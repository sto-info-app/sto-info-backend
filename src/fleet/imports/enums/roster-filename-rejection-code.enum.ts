/**
 * Why an export's filename is not evidence of anything.
 *
 * The filename is the only place an STO export records which Fleet it is of
 * and when it was taken — neither fact appears anywhere inside the file. That
 * makes it load-bearing, and it also makes it the one piece of provenance
 * somebody can change by renaming a file, which is why it is checked against
 * what this application already knows rather than believed.
 *
 * Every value describes the name. None quotes the file's contents, and none
 * says anything about a Fleet the caller could not already see.
 */
export enum RosterFilenameRejectionCode {
  /**
   * The name is not `<Fleet>_YYYYMMDD-HHMMSS.csv`.
   *
   * Anchored at both ends, so a manually annotated export — the 34 in the
   * analysed corpus carrying `_PrePromotions`, ` - Dragon Export` and the
   * like — is refused rather than trimmed back to something that matches.
   * Stripping a suffix would mean the recorded filename was not the filename,
   * and an export somebody has edited the name of is an export somebody has
   * had reason to handle.
   */
  SHAPE_UNRECOGNISED = 'SHAPE_UNRECOGNISED',

  /** The stamp is digits in the right places naming no real date or time. */
  STAMP_NOT_A_TIME = 'STAMP_NOT_A_TIME',

  /**
   * The stamp names a local time the export's timezone skipped.
   *
   * Nothing was exported in an hour that did not happen, so either the
   * timezone is wrong or the name is. Both are worth stopping for.
   */
  STAMP_NONEXISTENT = 'STAMP_NONEXISTENT',

  /**
   * The Fleet in the name is not this Fleet.
   *
   * Compared against the exact registered game name on its NFC form: not
   * case-folded, not trimmed, not punctuation-stripped and never against the
   * slug. A recorded historical alias counts, so a Fleet that has been renamed
   * can still import its back catalogue — but only an alias somebody
   * deliberately recorded, and only one whose interval covers the export.
   */
  FLEET_NAME_MISMATCH = 'FLEET_NAME_MISMATCH',

  /**
   * The stamp names two instants and the upload did not say which.
   *
   * Not a fault in the file. On the morning the clocks go back a stamp of
   * `01:30` is two moments an hour apart, and which one an export was taken
   * at decides which of two snapshots is the later — so it is a question
   * for whoever took it rather than something to guess at. The preview hands
   * back both candidates; the upload has to carry one of them.
   */
  STAMP_CHOICE_REQUIRED = 'STAMP_CHOICE_REQUIRED',

  /**
   * The upload named an instant the stamp could not have meant.
   *
   * Checked rather than trusted. An export instant decides the order of a
   * Fleet’s history, and an arbitrary one supplied by the caller would let
   * somebody reorder it by asserting a time the file does not support.
   */
  STAMP_CHOICE_NOT_A_CANDIDATE = 'STAMP_CHOICE_NOT_A_CANDIDATE',
}
