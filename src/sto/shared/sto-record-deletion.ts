/**
 * What deleting an STO Account or Character asks of features that describe
 * them, which the STO and user modules cannot import without a cycle.
 *
 * Custom Tracking provides it globally, so the pictures recorded about a
 * deleted Account or Character are taken down when it goes; the services
 * that delete take it when it is there.
 */
export interface StoRecordDeletion {
  /**
   * Takes down what described some Characters that have been deleted.
   *
   * @param characterIds - The Characters, already deleted.
   * @param reason - Why, as the file registry records it.
   */
  charactersDeleted(characterIds: string[], reason: string): Promise<void>;

  /**
   * Takes down what described some STO Accounts that have been deleted, and
   * the Characters on them.
   *
   * @param accountIds - The Accounts, already deleted.
   * @param reason - Why, as the file registry records it.
   */
  accountsDeleted(accountIds: string[], reason: string): Promise<void>;
}

/** The injection token for {@link StoRecordDeletion}. */
export const STO_RECORD_DELETION = Symbol('STO_RECORD_DELETION');
