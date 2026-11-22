/**
 * What a publisher needs that the registry does not hold.
 *
 * Written at ingress and read once, minutes later, by whatever publishes the
 * picture. Two of the three are about Cloudflare's own bookkeeping: an image
 * there carries a custom identifier and a metadata block naming what it
 * belongs to, and both are composed from values the uploading feature knows
 * and the registry does not — a Custom Tracking picture's tag depends on
 * the shape the Field asked for, not on the kind of record it answers.
 *
 * The third, {@link AssetPlacementDetail.feature}, is for whatever the
 * owning feature cannot recompute. Only Custom Tracking uses it today, for
 * the alt text typed alongside the file: the row that will hold it is not
 * written until publication, so there is nowhere else for it to wait.
 */
export interface AssetPlacementDetail {
  /** What kind of thing the image is, as Cloudflare records it. */
  readonly entityTag: string;
  /** What the image belongs to, as Cloudflare records it. */
  readonly entityId: string;
  /** Whatever the owning feature needs back at publication. */
  readonly feature?: Record<string, unknown> | null;
}

/**
 * Reads a placement's detail back out of the column it was stored in.
 *
 * `jsonb` comes back as whatever was put in it, and what was put in it was
 * written by a version of this application that may no longer be running.
 * Anything that does not carry the two Cloudflare values is treated as
 * absent rather than half-read, because a publisher that guessed at a
 * missing tag would record an image against the wrong thing.
 *
 * @param detail - The stored column.
 * @returns The detail, or null when there is nothing usable in it.
 */
export function readAssetPlacementDetail(
  detail: Record<string, unknown> | null,
): AssetPlacementDetail | null {
  if (detail === null) {
    return null;
  }

  const entityTag = detail.entityTag;
  const entityId = detail.entityId;

  if (typeof entityTag !== 'string' || typeof entityId !== 'string') {
    return null;
  }

  const feature = detail.feature;

  return {
    entityTag,
    entityId,
    feature:
      typeof feature === 'object' && feature !== null
        ? (feature as Record<string, unknown>)
        : null,
  };
}
