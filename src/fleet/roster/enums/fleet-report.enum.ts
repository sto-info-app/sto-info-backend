/**
 * The reports a Fleet has, each with an audience of its own (FC-020).
 *
 * The five built from the roster history. Recruitment and event attendance
 * join them with their stories. Holdings are public, so they have no
 * audience to choose and are not among them (FC-023).
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
}
