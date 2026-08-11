/**
 * Normalizes a handle for case-insensitive comparison and uniqueness checks.
 *
 * The result is persisted as `handleNormalized` / `fullHandleNormalized` and
 * backs the unique indexes on those columns, so this transformation must stay
 * stable.
 *
 * @param handle - The raw handle value.
 * @returns The trimmed, lower-cased handle.
 *
 * @example
 * ```typescript
 * normalizeHandle('  SteveX#1234 '); // 'stevex#1234'
 * ```
 */
export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

/**
 * Generates a URL-safe slug from a handle by replacing '#' with '~'.
 *
 * STO handles may contain a '#' discriminator, which terminates the path
 * portion of a URL, so it is swapped for a character that survives routing.
 *
 * @param handle - The raw handle value.
 * @returns A URL-safe slug.
 *
 * @example
 * ```typescript
 * generateSlug('SteveX#1234'); // 'SteveX~1234'
 * ```
 */
export function generateSlug(handle: string): string {
  return handle.trim().replaceAll('#', '~');
}
