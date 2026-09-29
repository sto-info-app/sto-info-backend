/** Who a rescan campaign is for (FC-041). */
export enum RescanCampaignKind {
  /** Started by a site admin, with a selection. */
  MANUAL = 'MANUAL',
  /** The legacy estate, started once by the system after release. */
  LEGACY = 'LEGACY',
}

/** Where a campaign is. */
export enum RescanCampaignState {
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
  /** Stopped by an error; resumed like a pause. */
  FAILED = 'FAILED',
}

/** What became of one rescan. */
export enum RescanState {
  /** Staged and queued; no verdict yet. */
  REQUESTED = 'REQUESTED',
  /** Cleared by today's scanner and policy. */
  CLEAN = 'CLEAN',
  /** The scanner found something: the picture is taken down. */
  INFECTED = 'INFECTED',
  /** Refused for a policy reason: the picture stays up, reported. */
  REFUSED = 'REFUSED',
  /** No verdict: gone missing, changed, or out of retries. Tried again later. */
  FAILED = 'FAILED',
}
