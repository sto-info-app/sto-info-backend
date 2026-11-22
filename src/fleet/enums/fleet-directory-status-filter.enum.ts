/**
 * Which lifecycle states a directory listing includes.
 *
 * Closed scopes are hidden by default and reachable by filter, because the two
 * people using a directory want opposite things. Somebody looking for a Fleet
 * to join wants the ones that still exist; somebody checking whether a name is
 * already taken wants every record there has ever been, and being shown only
 * the live ones would tell them the name is free when it is not.
 *
 * A closed scope is never *unreachable*: it keeps its canonical URL and stays
 * readable, which is what closure means here — plan section 4.1. This filter
 * governs the listing alone.
 *
 * {@link FleetScopeStatus.SUSPENDED} deliberately has no value of its own. It
 * is an administrative hold rather than something a visitor is browsing for,
 * and a filter named for it would invite a directory page advertising which
 * Communities are in trouble. Suspended records appear under {@link ANY} and
 * nowhere else.
 */
export enum FleetDirectoryStatusFilter {
  /** Operating scopes alone. The default. */
  ACTIVE = 'ACTIVE',
  /** Closed scopes alone, for checking what a name once belonged to. */
  CLOSED = 'CLOSED',
  /** Every record, whatever its state, including suspended ones. */
  ANY = 'ANY',
}
