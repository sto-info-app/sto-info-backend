/**
 * The kind of record an asset is placed against.
 *
 * Half of the answer to "what is this picture for". The other half is
 * {@link FileAssetSlot}: a Story has both a banner and a profile image, and a
 * placement is identified by the pair together with the record's own
 * identifier.
 *
 * This names a row rather than a feature, because the publisher for each of
 * these has exactly one table to write to and one column to set. A value
 * added here without a publisher registered against it is an upload that
 * reaches `CLEAN` and never publishes, which is why
 * {@link AssetPublisherRegistry} refuses an unknown subject at ingress rather
 * than at publication.
 */
export enum FileAssetSubject {
  /** A user's own profile, in `user_profile`. */
  USER_PROFILE = 'USER_PROFILE',

  /** A Star Trek Online character, in `character`. */
  STO_CHARACTER = 'STO_CHARACTER',

  /** A Storytime arc. */
  STORYTIME_ARC = 'STORYTIME_ARC',

  /** A Storytime story. */
  STORYTIME_STORY = 'STORYTIME_STORY',

  /** A Storytime chapter. */
  STORYTIME_CHAPTER = 'STORYTIME_CHAPTER',

  /** A character in a Storytime story's cast. */
  STORYTIME_CAST_MEMBER = 'STORYTIME_CAST_MEMBER',

  /** An administrator's Storytime spotlight. */
  STORYTIME_SPOTLIGHT = 'STORYTIME_SPOTLIGHT',

  /**
   * A picture answering one Custom Tracking image Field.
   *
   * The only subject whose identifier is not a single row's primary key. A
   * Custom Tracking picture is identified by the Field and the record it
   * describes together, and the row that holds it does not exist until the
   * picture is published — see {@link FileAssetPlacementEntity.subjectId}.
   */
  CUSTOM_TRACKING_VALUE = 'CUSTOM_TRACKING_VALUE',

  /** A registered Community. */
  FLEET_COMMUNITY = 'FLEET_COMMUNITY',

  /** A registered Fleet. */
  FLEET = 'FLEET',

  /** A registered Armada. */
  ARMADA = 'ARMADA',
}
