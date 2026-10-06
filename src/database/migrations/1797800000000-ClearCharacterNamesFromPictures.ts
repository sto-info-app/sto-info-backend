import { MigrationInterface, QueryRunner } from 'typeorm';

import { GUARDED_IMAGE_COLUMNS } from './1797300000000-GuardPublishedImageReferences';

/**
 * What a Character's picture can be: a key in the old public R2 bucket, which
 * always has a `/` in it (`<environment>/<userId>/<characterId>/<file>`), or a
 * Cloudflare Images ID — either the custom one the site gives every upload,
 * `<environment>-<userId>-…`, or a bare UUID. A Character's name is none of
 * these.
 */
export const CHARACTER_PICTURE_SHAPE = `^([a-z0-9]+-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-|$)`;

/** The tables that keep a file asset from being deleted. */
export const FILE_ASSET_REFERENCES: readonly (readonly [string, string])[] = [
  ['sto_info_app', 'fleet_roster_import_source'],
  ['sto_info_app', 'file_asset_placement'],
  ['sto_info_app', 'image_estate_step'],
  ['sto_info_app', 'file_rescan'],
  ['sto_info_worker', 'file_scan_attempt'],
];

/** A value that cannot be a Character's picture. */
const NOT_A_PICTURE = `"profilePictureId" IS NOT NULL
   AND POSITION('/' IN "profilePictureId") = 0
   AND "profilePictureId" !~* '${CHARACTER_PICTURE_SHAPE}'`;

/**
 * Takes Character names out of the Character picture column (FC-045).
 *
 * Two production migrations of January 2026 renamed `character.name` to
 * `profilePictureId` and then copied it back into a new `name` column without
 * clearing it, so every Character made before then names itself as its
 * picture: a broken picture on the site today. FC-008's backfill then
 * registers each of those names as a legacy picture, which FC-040's private
 * copy and FC-041's legacy rescan would ask Cloudflare for and fail.
 *
 * Steve's decision of 6 October 2026: clear them after the backfill.
 *
 * 1. Every Character picture that cannot be one — no `/`, and not shaped like
 *    a Cloudflare Images ID ({@link CHARACTER_PICTURE_SHAPE}) — is set to
 *    NULL. The picture guard always allows NULL.
 * 2. The legacy file assets the backfill made for those values are deleted,
 *    but only while they are still `UNVERIFIED` public pictures that no
 *    picture column holds and nothing refers to: on an environment where
 *    FC-040's copy or a rescan has already looked at one, it stays, and is
 *    counted.
 *
 * Nothing is lost that was a picture. The names were never pictures, and a
 * Character's name is its `handle`.
 */
export class ClearCharacterNamesFromPictures1797800000000 implements MigrationInterface {
  name = 'ClearCharacterNamesFromPictures1797800000000';

  /**
   * Clears the names, then the assets made only for them.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    const held = GUARDED_IMAGE_COLUMNS.map(
      ([table, column]) =>
        `SELECT "${column}" AS "value" FROM "sto_info_app"."${table}" WHERE "${column}" IS NOT NULL`,
    ).join(' UNION ');
    // The worker's table exists only once the worker has been deployed.
    const referenced = FILE_ASSET_REFERENCES.map(
      ([schema, table]) =>
        `IF to_regclass('"${schema}"."${table}"') IS NOT NULL THEN EXECUTE 'DELETE FROM pg_temp."fc045_unpictured" n USING "${schema}"."${table}" r WHERE r."assetId" = n."id"'; END IF;`,
    ).join(' ');

    await queryRunner.query(
      `CREATE TEMPORARY TABLE "fc045_cleared" AS
         SELECT DISTINCT "profilePictureId" AS "value"
           FROM "sto_info_app"."character" WHERE ${NOT_A_PICTURE}`,
    );
    await queryRunner.query(
      `UPDATE "sto_info_app"."character" SET "profilePictureId" = NULL WHERE ${NOT_A_PICTURE}`,
    );
    await queryRunner.query(
      `CREATE TEMPORARY TABLE "fc045_unpictured" AS
         SELECT a."id" FROM "sto_info_app"."file_asset" a
           JOIN pg_temp."fc045_cleared" c ON c."value" = a."objectKey"
          WHERE a."state" = 'UNVERIFIED'
            AND a."storage" = 'PUBLIC_IMAGES'
            AND a."objectKey" NOT IN (${held})`,
    );
    await queryRunner.query(`DO $$ BEGIN ${referenced} END $$`);
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."file_asset" a USING pg_temp."fc045_unpictured" n WHERE a."id" = n."id"`,
    );
    await queryRunner.query(
      `DROP TABLE pg_temp."fc045_unpictured", pg_temp."fc045_cleared"`,
    );
  }

  /**
   * Puts nothing back: the values were Character names, never pictures, and
   * putting them back would only break the pictures again. The Characters'
   * names are in `handle`.
   */
  public async down(): Promise<void> {
    // Deliberately empty.
  }
}
