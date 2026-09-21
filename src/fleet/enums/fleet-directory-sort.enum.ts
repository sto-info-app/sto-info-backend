/**
 * How a directory listing is ordered.
 *
 * `NAME` is the default everywhere, and not only because it is familiar: two
 * records for the same in-game Fleet fold to the same name, so ordering by it
 * puts them next to each other. A duplicate-aware directory that scattered
 * duplicates across four pages would be answering FC-013's third acceptance
 * criterion in form and failing it in practice.
 *
 * `FRESHNESS` is offered on the Fleet directory alone. Nothing observes a
 * Community or an Armada, so neither has a roster import to be fresh, and a
 * sort that silently fell back to something else would be worse than a `400`.
 */
export enum FleetDirectorySort {
  /** Exact game name, A–Z, so records answering to one name sit together. */
  NAME = 'NAME',
  /** Most recently registered first. */
  NEWEST = 'NEWEST',
  /**
   * Newest effective roster import first, records with none last.
   *
   * Fleet directory only. "Last observed" rather than "last edited": a record
   * somebody renamed yesterday and has not imported since 2024 is stale, and
   * this is the ordering that says so.
   */
  FRESHNESS = 'FRESHNESS',
}

/**
 * The orderings a listing with no roster behind it may accept.
 *
 * Used by the Community and Armada directories, which share the enum rather
 * than each declaring a near-copy of it. Restricting the values here keeps the
 * refusal honest: asking an Armada listing for `FRESHNESS` is a mistake in the
 * caller, and it is told so.
 */
export const SORTS_WITHOUT_FRESHNESS: readonly FleetDirectorySort[] = [
  FleetDirectorySort.NAME,
  FleetDirectorySort.NEWEST,
];
