/** Why a file this Fleet has imported before was not simply answered with it. */
export enum RosterRepeatRejectionCode {
  /**
   * The same bytes arrived with a different reading.
   *
   * A different export timezone, a different choice between the two instants
   * an ambiguous stamp names, or a renamed file whose stamp says another
   * time. The earlier import's reading stands, and answering the upload with
   * it would tell the uploader that the reading they just gave was accepted
   * when it was not. Correcting how an import was read is its own change.
   */
  ALREADY_IMPORTED_DIFFERENTLY = 'ALREADY_IMPORTED_DIFFERENTLY',
}
