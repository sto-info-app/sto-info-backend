/**
 * The reports a Fleet has (FC-020, FC-030).
 *
 * The five built from the roster history, then event attendance and
 * recruitment, each with an audience of its own the Owner chooses. Holdings
 * are public, like the Holdings page, so theirs is never chosen or stored.
 */
export enum FleetReport {
  /** Who joined and who left, interval by interval. */
  GROWTH = 'GROWTH',
  /** How long members have been listed. */
  TENURE = 'TENURE',
  /** How many members hold each rank label. */
  RANKS = 'RANKS',
  /** How recently members were active, in bands, at each export. */
  ACTIVITY = 'ACTIVITY',
  /** What was contributed between exports. */
  CONTRIBUTION = 'CONTRIBUTION',
  /** Who came to the Fleet's own events (FC-030). */
  ATTENDANCE = 'ATTENDANCE',
  /** How applications and invitations turned out, month by month (FC-030). */
  RECRUITMENT = 'RECRUITMENT',
  /** How the Fleet's holdings changed (FC-030). Public. */
  HOLDINGS = 'HOLDINGS',
}

/** The reports read from the roster history, for a Fleet whose game exports one. */
export const ROSTER_REPORTS: ReadonlySet<FleetReport> = new Set([
  FleetReport.GROWTH,
  FleetReport.TENURE,
  FleetReport.RANKS,
  FleetReport.ACTIVITY,
  FleetReport.CONTRIBUTION,
]);

/** The reports shown to everybody who may see the Fleet, with no audience. */
export const PUBLIC_REPORTS: ReadonlySet<FleetReport> = new Set([
  FleetReport.HOLDINGS,
]);
