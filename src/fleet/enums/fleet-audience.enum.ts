/**
 * Who may see a Fleet Community record or field.
 *
 * Ordered from widest to narrowest, but deliberately not treated as a number:
 * every check names the audience it requires, so inserting a value later cannot
 * silently widen an existing one.
 *
 * `COMMUNITY` is the owning Community's followers and members. It is not the
 * `src/community` social graph, which is friendships and blocks — see
 * ADR-0008. Audience is visibility only and never implies access: an approved
 * membership is a separate record, which is ADR-0002.
 */
export enum FleetAudience {
  /** Anyone, including signed-out visitors. */
  PUBLIC = 'PUBLIC',
  /** Subscribers to and members of the owning Community. */
  COMMUNITY = 'COMMUNITY',
  /** Approved members of the Fleet itself. */
  FLEET_MEMBERS = 'FLEET_MEMBERS',
  /** The owning user alone. */
  PRIVATE = 'PRIVATE',
}
