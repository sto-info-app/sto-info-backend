/** Which of a Fleet's conflict groups an investigator asks for (FC-020). */
export enum RosterImportConflictFilter {
  /** Waiting for somebody to select: never settled, or reopened. */
  OPEN = 'OPEN',
  /** Settled, with a selection standing. */
  SETTLED = 'SETTLED',
  /** Every one. */
  ALL = 'ALL',
}
