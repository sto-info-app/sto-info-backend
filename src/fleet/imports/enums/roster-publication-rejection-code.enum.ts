/** Why a cleared roster file was not read into observations. */
export enum RosterPublicationRejectionCode {
  /**
   * The placement names an import that does not exist, or one recorded
   * against a different file.
   *
   * Not something an uploader can cause. It means a placement and a
   * provenance row disagree about which bytes they describe, and reading the
   * file into either would be reading it into the wrong one.
   */
  NOT_THIS_IMPORT = 'NOT_THIS_IMPORT',

  /**
   * The import does not record which zone the export was taken in.
   *
   * Every upload since FC-017 records one, so this is an import from before
   * then. Its dates could only be read by guessing a zone, and a guessed zone
   * is the error this whole shape exists to prevent.
   */
  EXPORT_TIMEZONE_MISSING = 'EXPORT_TIMEZONE_MISSING',
}
