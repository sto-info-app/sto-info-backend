/**
 * Where an application to a Fleet stands (FC-021).
 *
 * A decision is made once, from `PENDING`, and a database trigger refuses to
 * change it afterwards.
 */
export enum FleetApplicationStatus {
  /** Waiting for a decider. */
  PENDING = 'PENDING',
  /** Accepted: the applicant is a member. */
  ACCEPTED = 'ACCEPTED',
  /** Turned down, with a reason the applicant is shown. */
  REJECTED = 'REJECTED',
  /** The applicant took it back before a decision. */
  WITHDRAWN = 'WITHDRAWN',
}
