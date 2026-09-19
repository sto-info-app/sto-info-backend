import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Counts the estate that predates the registry (FC-008).
 *
 * Writes one `file_asset` row for every image reference already in the
 * database, in state `UNVERIFIED` and with its delivery arrangements left
 * exactly as they are. Nothing changes for a reader: every profile picture,
 * portrait, Storytime image and Custom Tracking picture is served from the
 * same URL after this migration as before it.
 *
 * `UNVERIFIED` is not a failure and not a pass. These objects were uploaded
 * through a synchronous scanner call that returned nothing durable and was
 * made against a buffer in memory rather than against the object that ended up
 * stored, so there is no evidence about the bytes that are actually there. The
 * honest record of that is a state that says so. Gating these is FC-012's and
 * rescanning them is W10's; what this buys today is that the estate is
 * **counted** rather than described, so a campaign has a work list and an
 * inventory has a number that cannot go stale.
 *
 * Three decisions in the selection are worth stating.
 *
 * **Soft-deleted parents are included.** A Storytime chapter somebody removed
 * still has its cover image sitting in Cloudflare, and an object nobody
 * remembers is exactly the kind a rescan must not miss. The row is about the
 * object, not about whether anything currently renders it.
 *
 * **The owner is resolved where it is one or two joins away and left null
 * otherwise.** A Character's uploader comes through its account; a Custom
 * Tracking picture's comes through its value's account or its Character's.
 * Where neither path leads anywhere the column stays null, because recording
 * that the uploader is unknown is better than attributing somebody's file to
 * the wrong person.
 *
 * **A Character portrait may be either kind of object.** The pre-Images
 * arrangement stored an R2 key, which contains slashes; a Cloudflare Images
 * identifier does not. That is the same test the entity's own URL builder
 * makes, and it decides `LEGACY_PUBLIC_R2` against `PUBLIC_IMAGES` here —
 * which matters, because withdrawing one is deleting an object and purging a
 * custom domain, and withdrawing the other is deleting an image so that every
 * variant of it dies at once.
 */
export class BackfillLegacyFileAssets1792200000000 implements MigrationInterface {
  name = 'BackfillLegacyFileAssets1792200000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."file_asset"
        ("kind", "state", "audience", "storage", "ownerUserId", "objectKey")
      SELECT DISTINCT ON (source."storage", source."objectKey")
        source."kind"::"sto_info_app"."file_asset_kind_enum",
        'UNVERIFIED'::"sto_info_app"."file_asset_state_enum",
        'PUBLIC'::"sto_info_app"."file_asset_audience_enum",
        source."storage"::"sto_info_app"."file_asset_storage_enum",
        source."ownerUserId",
        source."objectKey"
      FROM (
        SELECT 'PROFILE_IMAGE' AS "kind", 'PUBLIC_IMAGES' AS "storage",
               profile."userId" AS "ownerUserId", profile."profilePictureId" AS "objectKey"
        FROM "sto_info_app"."user_profile" profile
        WHERE profile."profilePictureId" IS NOT NULL

        UNION ALL
        SELECT 'CHARACTER_IMAGE',
               CASE WHEN POSITION('/' IN sto_character."profilePictureId") > 0
                    THEN 'LEGACY_PUBLIC_R2' ELSE 'PUBLIC_IMAGES' END,
               sto_account."userId", sto_character."profilePictureId"
        FROM "sto_info_app"."character" sto_character
        LEFT JOIN "sto_info_app"."account" sto_account ON sto_account."id" = sto_character."accountId"
        WHERE sto_character."profilePictureId" IS NOT NULL

        UNION ALL
        SELECT 'STORYTIME_IMAGE', 'PUBLIC_IMAGES', arc."ownerUserId", arc."bannerImageId"
        FROM "sto_info_app"."storytime_arc" arc
        WHERE arc."bannerImageId" IS NOT NULL

        UNION ALL
        SELECT 'STORYTIME_IMAGE', 'PUBLIC_IMAGES', arc."ownerUserId", arc."profileImageId"
        FROM "sto_info_app"."storytime_arc" arc
        WHERE arc."profileImageId" IS NOT NULL

        UNION ALL
        SELECT 'STORYTIME_IMAGE', 'PUBLIC_IMAGES', story."ownerUserId", story."bannerImageId"
        FROM "sto_info_app"."storytime_story" story
        WHERE story."bannerImageId" IS NOT NULL

        UNION ALL
        SELECT 'STORYTIME_IMAGE', 'PUBLIC_IMAGES', story."ownerUserId", story."profileImageId"
        FROM "sto_info_app"."storytime_story" story
        WHERE story."profileImageId" IS NOT NULL

        UNION ALL
        SELECT 'STORYTIME_IMAGE', 'PUBLIC_IMAGES', story."ownerUserId", chapter."coverImageId"
        FROM "sto_info_app"."storytime_chapter" chapter
        LEFT JOIN "sto_info_app"."storytime_story" story ON story."id" = chapter."storyId"
        WHERE chapter."coverImageId" IS NOT NULL

        UNION ALL
        SELECT 'STORYTIME_IMAGE', 'PUBLIC_IMAGES', story."ownerUserId", cast_member."portraitImageId"
        FROM "sto_info_app"."storytime_character" cast_member
        LEFT JOIN "sto_info_app"."storytime_story" story ON story."id" = cast_member."storyId"
        WHERE cast_member."portraitImageId" IS NOT NULL

        UNION ALL
        SELECT 'STORYTIME_IMAGE', 'PUBLIC_IMAGES', spotlight."createdByUserId", spotlight."overrideImageId"
        FROM "sto_info_app"."storytime_spotlight" spotlight
        WHERE spotlight."overrideImageId" IS NOT NULL

        UNION ALL
        SELECT 'CUSTOM_TRACKING_IMAGE', 'PUBLIC_IMAGES',
               COALESCE(value_account."userId", character_account."userId"),
               image_value."cloudflareImageId"
        FROM "sto_info_app"."custom_tracking_image_value" image_value
        LEFT JOIN "sto_info_app"."custom_tracking_value" tracking_value ON tracking_value."id" = image_value."valueId"
        LEFT JOIN "sto_info_app"."account" value_account ON value_account."id" = tracking_value."accountId"
        LEFT JOIN "sto_info_app"."character" value_character ON value_character."id" = tracking_value."characterId"
        LEFT JOIN "sto_info_app"."account" character_account ON character_account."id" = value_character."accountId"
        WHERE image_value."cloudflareImageId" IS NOT NULL
      ) source
      WHERE NOT EXISTS (
        SELECT 1 FROM "sto_info_app"."file_asset" existing
        WHERE existing."objectKey" = source."objectKey"
          AND existing."storage"::text = source."storage"
          AND existing."deletedAt" IS NULL
      )
    `);
  }

  /**
   * Reverts the migration.
   *
   * Removes only the rows this migration could have written: `UNVERIFIED` is
   * reachable no other way, since every asset registered through the service
   * starts in `RECEIVING`. A row that has since been published or withdrawn
   * has left `UNVERIFIED` and is deliberately left alone — reverting the
   * counting of the estate must not delete the record of an object that has
   * since been scanned.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "sto_info_app"."file_asset"
      WHERE "state" = 'UNVERIFIED'
        AND "storage" IN ('PUBLIC_IMAGES', 'LEGACY_PUBLIC_R2')
    `);
  }
}
