import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every feature column that holds a picture's delivery reference: a
 * Cloudflare Images ID, or a legacy R2 key (FC-040's 17).
 *
 * Written out rather than read from `IMAGE_REFERENCE_COLUMNS`, because a
 * migration must say what it did on the day it ran, whatever the application
 * later calls its columns. The migration's spec compares the two, so a picture
 * column added later fails a test until it is guarded too.
 */
export const GUARDED_IMAGE_COLUMNS: readonly (readonly [string, string])[] = [
  ['user_profile', 'profilePictureId'],
  ['character', 'profilePictureId'],
  ['storytime_arc', 'bannerImageId'],
  ['storytime_arc', 'profileImageId'],
  ['storytime_story', 'bannerImageId'],
  ['storytime_story', 'profileImageId'],
  ['storytime_chapter', 'coverImageId'],
  ['storytime_character', 'portraitImageId'],
  ['storytime_spotlight', 'overrideImageId'],
  ['custom_tracking_image_value', 'cloudflareImageId'],
  ['fleet_community', 'bannerImageId'],
  ['fleet_community', 'emblemImageId'],
  ['sto_fleet', 'bannerImageId'],
  ['sto_fleet', 'emblemImageId'],
  ['sto_armada', 'bannerImageId'],
  ['sto_armada', 'emblemImageId'],
  ['news_post', 'coverImageId'],
];

/**
 * The SQLSTATE the guard raises. A code of its own, outside every class
 * PostgreSQL defines, so a log line or an alert can tell this refusal apart
 * from an ordinary constraint violation.
 */
export const PUBLISHED_IMAGE_GUARD_SQLSTATE = 'IRG01';

/**
 * Why the guard cannot be removed by a rollback, and what to do instead.
 */
export const PUBLISHED_IMAGE_GUARD_DOWN_REFUSAL =
  'GuardPublishedImageReferences1797300000000 refuses to revert. Removing the ' +
  'guard would let a rolled-back build, from before FC-012, publish pictures ' +
  'that were never scanned. Roll forward instead: fix the problem in a new ' +
  'migration, and leave this one in place.';

/**
 * The trigger that guards one column.
 *
 * @param table - The feature table.
 * @param column - Its picture column.
 * @returns The trigger's name.
 */
function triggerName(table: string, column: string): string {
  return `TR_${table}_${column}_published`;
}

/**
 * Lets a picture column take only a picture the registry has published
 * (FC-042).
 *
 * Builds from before FC-012 had a synchronous upload path:
 * `ImageUploadsService` sent the bytes straight to Cloudflare Images, or the
 * public R2 bucket, and wrote the new ID into the feature row, with no scan
 * and no registry row. A Render rollback to one of those builds runs
 * `start:render`, whose `migration:run` finds nothing to do against a newer
 * schema, and boots — with the bypass FC-012 closed open again.
 *
 * So the rule moves into the database, where an old build cannot skip it.
 * One trigger per picture column, before every insert and every update of
 * that column, lets the column take a value only when a `file_asset` has that
 * value as its `deliveryReference` and is in a showable state:
 *
 * - **`AVAILABLE`** — scanned, cleared and published. Every publisher sets its
 *   column after `FileAssetService.publish` has made the asset available.
 * - **`UNVERIFIED`** — the estate from before the registry, which FC-040 keeps
 *   on the site until FC-041 has scanned it. FC-040's copy to private delivery
 *   and its undo move the asset's `deliveryReference` first and then rewrite
 *   the columns, in one transaction, so the rewrite finds the asset. No build
 *   before FC-012 ever inserts a `file_asset` row — the backfill migration
 *   wrote every one it has — so an old build cannot make an `UNVERIFIED` row
 *   for its own upload.
 *
 * Setting a column to NULL, and an update that leaves its value as it was,
 * are always allowed: removing a picture is never the danger, and rows that
 * predate the guard must stay editable.
 *
 * The refusal names the table and the column, never the value, and carries
 * {@link PUBLISHED_IMAGE_GUARD_SQLSTATE}.
 *
 * **The down migration refuses.** A revert would remove the guard just when a
 * rollback makes it matter; the way back is forward.
 */
export class GuardPublishedImageReferences1797300000000 implements MigrationInterface {
  name = 'GuardPublishedImageReferences1797300000000';

  /**
   * Creates the guard function and one trigger per picture column.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The column is the trigger's argument, so one function serves all 17.
    // to_jsonb reads a column by name without dynamic SQL.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."published_image_reference_guard"()
      RETURNS trigger AS $$
      DECLARE
        reference text := to_jsonb(NEW) ->> TG_ARGV[0];
      BEGIN
        IF reference IS NULL THEN
          RETURN NEW;
        END IF;

        IF TG_OP = 'UPDATE' AND reference IS NOT DISTINCT FROM (to_jsonb(OLD) ->> TG_ARGV[0]) THEN
          RETURN NEW;
        END IF;

        IF EXISTS (
          SELECT 1 FROM "sto_info_app"."file_asset" asset
          WHERE asset."deliveryReference" = reference
            AND asset."state" IN ('AVAILABLE', 'UNVERIFIED')
        ) THEN
          RETURN NEW;
        END IF;

        RAISE EXCEPTION '%.% may only hold a picture the asset registry has published', TG_TABLE_NAME, TG_ARGV[0]
          USING ERRCODE = '${PUBLISHED_IMAGE_GUARD_SQLSTATE}';
      END;
      $$ LANGUAGE plpgsql`);

    for (const [table, column] of GUARDED_IMAGE_COLUMNS) {
      await queryRunner.query(
        `CREATE TRIGGER "${triggerName(table, column)}" BEFORE INSERT OR UPDATE OF "${column}" ON "sto_info_app"."${table}" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."published_image_reference_guard"('${column}')`,
      );
    }
  }

  /**
   * Refuses. Removing the guard would let a rolled-back build publish
   * unscanned pictures; the way back is to roll forward.
   *
   * @throws Error always, before changing anything.
   */
  public down(): Promise<void> {
    return Promise.reject(new Error(PUBLISHED_IMAGE_GUARD_DOWN_REFUSAL));
  }
}
