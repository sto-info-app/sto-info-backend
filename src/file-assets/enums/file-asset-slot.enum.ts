/**
 * Which picture of a record's several an asset is.
 *
 * Deliberately generic. A slot name paired with a {@link FileAssetSubject} is
 * unambiguous — `STORYTIME_STORY` plus `BANNER` is one column of one table —
 * and keeping the two apart stops this enum growing a value per feature per
 * picture, which is eleven subjects multiplied by however many pictures each
 * grows later.
 *
 * Every value here corresponds to a column somewhere that holds a Cloudflare
 * Images identifier. Nothing else belongs in it: a retained roster import
 * source has no slot, because nothing displays it.
 */
export enum FileAssetSlot {
  /** The record's only picture. A profile picture, a Custom Tracking answer. */
  PICTURE = 'PICTURE',

  /** A likeness of a person or character. */
  PORTRAIT = 'PORTRAIT',

  /** The wide image across the top of something. */
  BANNER = 'BANNER',

  /** The square image that represents something in a listing. */
  PROFILE = 'PROFILE',

  /** A chapter's cover. */
  COVER = 'COVER',

  /** An administrator's replacement for whatever would be shown otherwise. */
  OVERRIDE = 'OVERRIDE',

  /**
   * A Fleet scope's emblem.
   *
   * Registered here with no route that writes it. FC-012 builds the ingress
   * and the specs; FC-013 onwards adds the endpoints, by which time the path
   * has been exercised ten times over by the callers that do exist.
   */
  EMBLEM = 'EMBLEM',
}
