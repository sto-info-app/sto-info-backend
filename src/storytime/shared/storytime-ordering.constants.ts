/**
 * The gap left between consecutive items when a collection is numbered.
 *
 * Ordering uses gapped integers so inserting between two neighbours is a single
 * write to the new row, rather than a renumber of everything after it. With a
 * gap of 1000 a position can be halved roughly ten times before the space runs
 * out, which in practice means a creator never triggers a renumber by dragging
 * a Chapter around.
 */
export const ORDER_INDEX_GAP = 1000;

/**
 * The first position in an empty collection.
 */
export const ORDER_INDEX_START = ORDER_INDEX_GAP;

/**
 * The smallest gap that can still be divided.
 *
 * Once two neighbours are this close there is no whole number between them, so
 * the scope has to be renumbered before the insert can proceed.
 */
export const MINIMUM_DIVISIBLE_GAP = 2;
