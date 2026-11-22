/**
 * Where a set of uploaded bytes has got to.
 *
 * The publication state of an asset, and the only thing that decides whether
 * it may be served. Plan section 6.1 proposes the first six; `UNVERIFIED`,
 * `REVOKED` and the retry state complete them.
 *
 * Deliberately not an ordering. Every check names the states it accepts, so a
 * value added later cannot quietly fall on the serveable side of a comparison.
 * There is exactly one serveable state and it is named in one place —
 * {@link SERVEABLE_FILE_ASSET_STATES}.
 */
export enum FileAssetState {
  /**
   * Bytes that predate the registry, with no verdict of any kind.
   *
   * Not a failure and not a pass. It is the honest answer for the profile
   * pictures, portraits, Storytime artwork and Custom Tracking images that
   * were uploaded before any of this existed: nobody knows, because the
   * synchronous Cloudmersive call that once looked at them left no durable
   * evidence about the object that is stored now.
   *
   * These are still delivered by their existing public routes. Gating them is
   * FC-012 and rescanning them is W10; what this state buys today is that the
   * estate is counted rather than described.
   */
  UNVERIFIED = 'UNVERIFIED',

  /** A row exists and the bytes are still arriving. */
  RECEIVING = 'RECEIVING',

  /** The bytes are in the private bucket, waiting for a scanner. */
  QUARANTINED = 'QUARANTINED',

  /** A scanner has the object and has not yet answered. */
  SCANNING = 'SCANNING',

  /**
   * A scanner returned an affirmative clean verdict for exactly these bytes.
   *
   * Clean is not serveable. Publication additionally requires an allowed type,
   * successful processing and an audience — plan section 6.1, and this
   * ticket's first acceptance criterion.
   */
  CLEAN = 'CLEAN',

  /** Clean, processed, and published to an audience. The only serveable state. */
  AVAILABLE = 'AVAILABLE',

  /** A transient fault. Eligible to be scanned again; not serveable meanwhile. */
  RETRY_PENDING = 'RETRY_PENDING',

  /**
   * Refused, and never published.
   *
   * Covers an infection, an unsupported or encrypted payload, an exhausted
   * retry budget and a scanner that could not be trusted to answer. All of
   * them are the same thing to a reader: the file was not accepted.
   */
  REJECTED = 'REJECTED',

  /**
   * Was `AVAILABLE`, and is not any more.
   *
   * Distinct from `REJECTED` because the difference is operational rather than
   * cosmetic: bytes that were once published may sit in a CDN cache, in a
   * resized variant and behind a custom domain, so withdrawing them is a purge
   * and not merely a database write. `REJECTED` bytes never left the private
   * bucket and have nothing to purge.
   */
  REVOKED = 'REVOKED',

  /** The object has been removed from storage. The row remains as evidence. */
  DELETED = 'DELETED',
}

/**
 * The states in which an asset's bytes may be handed to a reader.
 *
 * A set of one. It is a named constant rather than an inline comparison so
 * that the first acceptance criterion — only `AVAILABLE` assets are served,
 * and a clean scanner status alone is not enough — is a single line that a
 * reviewer can check, rather than a condition repeated at every delivery site.
 */
export const SERVEABLE_FILE_ASSET_STATES: ReadonlySet<FileAssetState> = new Set(
  [FileAssetState.AVAILABLE],
);
