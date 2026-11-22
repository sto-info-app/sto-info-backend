/**
 * How much of a report a viewer is shown (FC-020).
 */
export enum FleetReportView {
  /**
   * Everything, names included: `reports.view` holders, and the Fleet's
   * members when the report's audience includes them.
   */
  FULL = 'FULL',
  /**
   * Counts and totals only, none from 1 to 4: the Community's followers, or
   * anyone, when the report's audience includes them.
   */
  AGGREGATE = 'AGGREGATE',
}
