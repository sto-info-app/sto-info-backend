/**
 * The segment standing where a Community's slug would, for a Fleet that has
 * no Community.
 *
 * A standalone Fleet is a record of a Fleet nobody here runs, and it needs an
 * address for the same reason every other record does: so it can be linked
 * to, and so the person about to confirm a second one can be shown the first.
 * It has no Community to name, so the position names its absence instead —
 * `/fleets/communities/standalone/fleets/{platform}/{fleetSlug}`.
 *
 * Reserved, therefore, against Community slugs. A Community called
 * "Standalone" would otherwise own the segment that means "no Community",
 * and one address would name two things; the slug service suffixes it the
 * way it suffixes any other name already taken.
 */
export const FLEET_STANDALONE_SEGMENT = 'standalone';
