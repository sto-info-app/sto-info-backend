/**
 * The platform's place in a Fleet URL — ADR-0022, decision 3.
 *
 * A Fleet's canonical address is
 * `/fleets/{communitySlug}/{platform}/{fleetSlug}`, and the platform segment
 * is derived from the catalogue name rather than stored: `Windows` becomes
 * `windows`, `PlayStation` becomes `playstation`, `Xbox` becomes `xbox`.
 *
 * Derived rather than held in a column because a second copy of a name is a
 * second thing to keep true, and the `platform` table is reference data an
 * operator seeds once. The accepted cost is that renaming a platform changes
 * every URL under it; ADR-0022 records that, and the outstanding risk is
 * carried in the ADR index rather than worked around here.
 *
 * Matching is case-insensitive on the way in, so `/PlayStation/` resolves,
 * while the canonical form a link is built from is always lowercase. A segment
 * naming no platform in the catalogue resolves to nothing at all: the caller
 * answers 404 rather than falling back to a default platform, because a URL
 * that quietly serves the wrong platform's Fleet is worse than a dead one.
 */

/** Runs of whitespace inside a platform name. */
const WHITESPACE_RUN_PATTERN = /\s+/g;

/**
 * Derives the URL segment for a platform.
 *
 * @param name - The catalogue name, as `platform.name` holds it.
 * @returns The lowercase segment, with any internal whitespace hyphenated.
 */
export function toPlatformSegment(name: string): string {
  return name.trim().toLowerCase().replaceAll(WHITESPACE_RUN_PATTERN, '-');
}

/**
 * Reduces a segment from an incoming URL to the form segments are compared in.
 *
 * Deliberately the same reduction as {@link toPlatformSegment} rather than a
 * looser one. A segment is only ever compared against derived segments, so
 * accepting more here than the derivation can produce would let a URL match
 * that no link on the site could have generated.
 *
 * @param segment - The segment as it arrived.
 * @returns The comparable form.
 */
export function normalisePlatformSegment(segment: string): string {
  return toPlatformSegment(segment);
}

/**
 * Finds the platform an incoming URL segment names.
 *
 * @param segment - The segment as it arrived, in any case.
 * @param platforms - The platforms to look in, from the catalogue.
 * @returns The matching platform, or null when the segment names none.
 */
export function findPlatformBySegment<T extends { name: string }>(
  segment: string,
  platforms: readonly T[],
): T | null {
  const wanted = normalisePlatformSegment(segment);

  return (
    platforms.find(platform => toPlatformSegment(platform.name) === wanted) ??
    null
  );
}
