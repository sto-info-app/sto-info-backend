/**
 * What a directory listing hands back, before it is mapped for the API.
 *
 * Entities rather than DTOs, because the three services that build these do
 * not know what a card looks like and should not: the mapper decides which
 * columns leave the application, and it is the only place that decides it.
 */

/** A page of records, with the total behind it. */
export interface DirectoryPage<T> {
  /** The records on this page, in the order asked for. */
  readonly items: readonly T[];
  /** How many records match, across every page. */
  readonly total: number;
  /** The page returned. */
  readonly page: number;
  /** How many records a page carries. */
  readonly pageSize: number;
}

/**
 * A record, with how many others answer to the same name on the same platform.
 *
 * Counted separately from the record because it is not a property of the
 * record at all: it depends on who is asking and on which lifecycle states
 * they asked to see. Storing it on the entity would make a number that is true
 * of one listing look like a fact about the Fleet.
 */
export interface DirectoryEntry<T> {
  /** The record itself. */
  readonly record: T;
  /** How many *other* listed records share its folded name and platform. */
  readonly duplicateCount: number;
}

/**
 * One row of the grouped query behind the duplicate counts.
 *
 * `total` is a string because that is what `COUNT(*)` comes back as: the
 * driver hands `bigint` over as text rather than risk a value JavaScript
 * cannot hold, and pretending otherwise would put `NaN` on a card.
 */
export interface DuplicateCountRow {
  /** The platform the group is on. */
  readonly platformId: string;
  /** The folded in-game name the group shares. */
  readonly name: string;
  /** How many records are in the group. */
  readonly total: string;
}
