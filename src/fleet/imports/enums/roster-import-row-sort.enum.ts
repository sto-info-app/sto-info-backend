/**
 * How one import's rows are ordered (FC-055).
 *
 * Every ordering ends on line, so a page boundary never falls differently
 * between two requests for the same import.
 */
export enum RosterImportRowSort {
  /** The line the export listed the row on. The default. */
  LINE = 'LINE',
  /** Character name, A–Z. */
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
