/**
 * What an asset is, from the application's point of view.
 *
 * Coarse on purpose. It is not the owning row and it is not the MIME type; it
 * is the answer to "which part of the site put this here", which is what a
 * rescan campaign filters on, what a retention policy is written against and
 * what the estate inventory counts.
 *
 * Every value that exists today describes something already stored. Fleet's
 * own kinds arrive with the tickets that upload them.
 */
export enum FileAssetKind {
  /** A user's profile picture. */
  PROFILE_IMAGE = 'PROFILE_IMAGE',

  /** A Character's portrait. */
  CHARACTER_IMAGE = 'CHARACTER_IMAGE',

  /** Storytime artwork: a banner, a cover, a profile or a spotlight. */
  STORYTIME_IMAGE = 'STORYTIME_IMAGE',

  /** A picture held in a user-defined Custom Tracking image field. */
  CUSTOM_TRACKING_IMAGE = 'CUSTOM_TRACKING_IMAGE',

  /**
   * The sanitised CSV retained from a roster import.
   *
   * Never the bytes that were uploaded. ADR-0001: the officer columns are
   * discarded at ingress and what is kept is a canonical re-serialisation of
   * the allowed columns, which is the thing that gets scanned and the thing
   * that gets retained for 180 days.
   */
  ROSTER_IMPORT_SOURCE = 'ROSTER_IMPORT_SOURCE',

  /** An image belonging to a Community, Fleet or Armada. */
  FLEET_IMAGE = 'FLEET_IMAGE',
}
