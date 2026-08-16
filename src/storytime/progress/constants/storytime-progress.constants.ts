/**
 * How far through a Chapter a reader must get before it counts as started.
 *
 * Opening a Chapter is not reading it. Without a threshold, following a link
 * and immediately leaving would mark the Chapter in progress and drag the
 * whole Story out of "not started", which makes a reader's library lie to
 * them.
 */
export const MEANINGFUL_PROGRESS_PERCENT = 5;

/**
 * How far through a Chapter counts as having finished it.
 *
 * Set below 100 because a reader rarely scrolls to the very last pixel: the
 * footer, the navigation and the comments all sit below the final paragraph.
 */
export const CHAPTER_COMPLETE_PERCENT = 95;

/**
 * The kind of position stored against a Chapter.
 *
 * Block anchors are the identifiers the Markdown renderer stamps on every
 * block. They survive a re-render and a change of screen size, which a pixel
 * offset does not.
 */
export const POSITION_TYPE_BLOCK = 'BLOCK';

/**
 * The shortest gap between progress writes the client should allow.
 *
 * Reading progress changes continuously as somebody scrolls; without
 * debouncing, a single Chapter would generate hundreds of writes. Published
 * here so the client and any future job agree on one number.
 */
export const PROGRESS_WRITE_DEBOUNCE_MS = 5000;
