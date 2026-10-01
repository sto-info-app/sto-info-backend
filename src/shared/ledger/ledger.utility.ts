import { performance } from 'node:perf_hooks';

/** How many rows or IDs one database read of a ledger check takes. */
export const LEDGER_CHUNK_SIZE = 500;

/** How many objects a ledger check writes or reads at once. */
export const LEDGER_CONCURRENCY = 8;

/** What every ID a ledger names looks like: a UUID. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a ledger's key says about its marker, so the restore check can
 * compare a ledger with the database without reading a body.
 */
export interface LedgerKey {
  /** The whole key. */
  readonly key: string;
  /** When the marker was made, as ISO 8601. */
  readonly createdAt: string;
  /** The record it is about. */
  readonly id: string;
  /** What happened to it, for a ledger that records more than one thing. */
  readonly kind: string | null;
}

/** How long each part of a ledger's check took, in milliseconds. */
export interface LedgerTimings {
  /** Listing the ledger's keys. */
  list: number;
  /** Reading the database and comparing. */
  compare: number;
  /** Bringing back what the database lacked. */
  replay: number;
  /** Writing markers for what the ledger lacked. */
  backfill: number;
}

/** What checking one ledger against the database came to (FC-042). */
export interface LedgerReconciliation {
  /** Markers the ledger held when it was listed. */
  readonly markers: number;
  /** Records the database lacked, and has again. */
  readonly replayed: number;
  /** Markers written for records the ledger lacked. */
  readonly backfilled: number;
  /** Anything else worth counting, by name. */
  readonly detail: Readonly<Record<string, number>>;
  /** How long each part took. */
  readonly timings: LedgerTimings;
}

/**
 * Names a marker: when, what about and, for a ledger that records more than
 * one thing, what. Keys sort oldest first.
 *
 * @param prefix - The ledger's prefix, ending in a slash.
 * @param createdAt - When, as ISO 8601.
 * @param id - The record it is about.
 * @param kind - What happened, or nothing.
 * @returns The key.
 */
export function ledgerKey(
  prefix: string,
  createdAt: string,
  id: string,
  kind?: string,
): string {
  return `${prefix}${createdAt}_${id}${kind === undefined ? '' : `_${kind}`}.json`;
}

/**
 * Reads what a key says about its marker. ISO 8601 instants, UUIDs and the
 * kinds the ledgers record hold no underscore, so the parts split cleanly.
 * A key naming something other than a UUID is refused, so the database is
 * never asked about an ID it cannot hold.
 *
 * @param prefix - The ledger's prefix.
 * @param key - The key.
 * @returns What it says, or null for a key no ledger wrote.
 */
export function parseLedgerKey(prefix: string, key: string): LedgerKey | null {
  if (!key.startsWith(prefix) || !key.endsWith('.json')) {
    return null;
  }

  const parts = key.slice(prefix.length, -'.json'.length).split('_');

  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some(part => part.length === 0) ||
    Number.isNaN(Date.parse(parts[0])) ||
    !UUID_PATTERN.test(parts[1])
  ) {
    return null;
  }

  return {
    key,
    createdAt: parts[0],
    id: parts[1],
    kind: parts[2] ?? null,
  };
}

/**
 * Splits a list into chunks, for reads that name IDs.
 *
 * @param items - The list.
 * @param size - How many to a chunk.
 * @returns The chunks, in order.
 */
export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }

  return chunks;
}

/**
 * Runs a step for each item, a few at a time, stopping at the first failure.
 *
 * @param items - The items.
 * @param limit - How many at once.
 * @param step - What to do with each.
 * @returns What each came to, in the items' order.
 */
export async function eachLimited<T, R>(
  items: readonly T[],
  limit: number,
  step: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;

      try {
        results[index] = await step(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

/**
 * Times a step, adding what it took to one of a check's timings.
 *
 * @param timings - The timings.
 * @param phase - Which part of the check it is.
 * @param step - The step.
 * @returns What the step came to.
 */
export async function timed<R>(
  timings: LedgerTimings,
  phase: keyof LedgerTimings,
  step: () => Promise<R>,
): Promise<R> {
  const start = performance.now();

  try {
    return await step();
  } finally {
    timings[phase] += performance.now() - start;
  }
}

/**
 * A check's timings before it starts.
 *
 * @returns Every part at nought.
 */
export function noTimings(): LedgerTimings {
  return { list: 0, compare: 0, replay: 0, backfill: 0 };
}
