/**
 * Where an asset's bytes physically are, and therefore what has to happen to
 * withdraw them.
 *
 * This exists for revocation. The third acceptance criterion is that a later
 * quarantine denies new fetches through legacy URLs, variants and caches, and
 * that is not one operation: a private object is withdrawn by a database
 * write, a Cloudflare Images object by deleting the image so every variant
 * dies with it, and a legacy public R2 object by deleting the object and
 * purging the custom domain's cache. Code that does not know which of the
 * three it is holding cannot do any of them correctly.
 */
export enum FileAssetStorage {
  /**
   * The private quarantine bucket.
   *
   * No public custom domain, no `r2.dev` subdomain, no Cloudflare Images
   * variant and no download token. Reachable only by the backend's own
   * credentials, and served only by the authenticated delivery endpoint.
   */
  QUARANTINE = 'QUARANTINE',

  /** Cloudflare Images, delivered through the custom domain's variants. */
  PUBLIC_IMAGES = 'PUBLIC_IMAGES',

  /**
   * An R2 object delivered through the public CDN root.
   *
   * The pre-Images arrangement, still referenced by some Character portraits.
   * No new asset is ever written here.
   */
  LEGACY_PUBLIC_R2 = 'LEGACY_PUBLIC_R2',

  /** The object is gone from wherever it was. */
  NONE = 'NONE',
}
