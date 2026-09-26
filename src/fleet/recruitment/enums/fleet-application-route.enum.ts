/**
 * How somebody came to be a member of a Fleet (FC-021).
 *
 * Every membership the recruitment feature grants leaves one
 * `fleet_application` row, whichever way in it took. Only `APPLICATION` waits
 * for a decision; the other two are accepted as they are made.
 */
export enum FleetApplicationRoute {
  /** Applied with the Fleet's form, and a decider answered. */
  APPLICATION = 'APPLICATION',
  /** Joined a Fleet whose recruitment state is OPEN. */
  OPEN_JOIN = 'OPEN_JOIN',
  /** Accepted an invitation an officer sent. */
  INVITATION = 'INVITATION',
}
