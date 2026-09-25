/**
 * How a Fleet's roster is ordered (FC-020).
 *
 * Every ordering ends on name, handle and line, so a page boundary never
 * falls differently between two requests for the same export.
 */
export enum RosterSort {
  /** Character name, A–Z. The default. */
  NAME = 'NAME',
  /** Account handle, A–Z. */
  HANDLE = 'HANDLE',
  /**
   * Rank tier, highest first, then rank label. Labels nobody has placed come
   * last whichever way it runs.
   */
  RANK = 'RANK',
  /** Level. */
  LEVEL = 'LEVEL',
  /** The Join Date the export reported. Rows with none come last. */
  JOINED = 'JOINED',
  /** Cumulative contribution. */
  CONTRIBUTION = 'CONTRIBUTION',
  /** Last Active. Rows with none come last. */
  LAST_ACTIVE = 'LAST_ACTIVE',
}

/** Which way a roster ordering runs. */
export enum RosterSortDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}
