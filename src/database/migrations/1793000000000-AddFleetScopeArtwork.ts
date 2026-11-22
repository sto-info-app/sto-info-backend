import { MigrationInterface, QueryRunner } from 'typeorm';

/** The three tables a Fleet scope's artwork hangs from. */
const SCOPE_TABLES = ['fleet_community', 'sto_fleet', 'sto_armada'];

/**
 * Gives a Community, Fleet and Armada a banner and an emblem (FC-013).
 *
 * Four columns on each of the three tables rather than one artwork table
 * keyed by scope. A picture is an attribute of the scope in exactly the way
 * its name and description are: it is read on every page that draws the
 * scope and written about as often as the name is, so a join to fetch it
 * would be a join on every read to save writes nobody is making. It is also
 * how `storytime_story` and `user_profile` already hold theirs, and the
 * publisher that writes these columns is the same shape as the ones that
 * write those.
 *
 * The identifier is the delivery reference the asset registry hands over at
 * publication, never a URL: what a picture is served from is a property of
 * the delivery configuration and has changed once already.
 *
 * **The description is not nullable in spirit.** It is nullable in the
 * column because a slot with no picture has nothing to describe, but the
 * upload route requires one whenever a picture is set, for the reason
 * FC-012 gives: the moment somebody has just cropped a picture is the only
 * moment they are certainly looking at it. A check constraint pairs the two
 * so a description cannot outlive the picture it describes, nor a picture
 * arrive without one — and it is written as an equivalence rather than as
 * two `IS NOT NULL` tests, because a CHECK comparing a nullable column
 * passes when the column is NULL.
 */
export class AddFleetScopeArtwork1793000000000 implements MigrationInterface {
  name = 'AddFleetScopeArtwork1793000000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of SCOPE_TABLES) {
      await queryRunner.query(`
        ALTER TABLE "sto_info_app"."${table}"
          ADD COLUMN "bannerImageId" character varying(160),
          ADD COLUMN "bannerImageAlt" character varying(300),
          ADD COLUMN "emblemImageId" character varying(160),
          ADD COLUMN "emblemImageAlt" character varying(300)
      `);

      await queryRunner.query(`
        ALTER TABLE "sto_info_app"."${table}"
          ADD CONSTRAINT "CHK_${table}_banner_described" CHECK (
            ("bannerImageId" IS NULL) = ("bannerImageAlt" IS NULL)
          )
      `);

      await queryRunner.query(`
        ALTER TABLE "sto_info_app"."${table}"
          ADD CONSTRAINT "CHK_${table}_emblem_described" CHECK (
            ("emblemImageId" IS NULL) = ("emblemImageAlt" IS NULL)
          )
      `);
    }
  }

  /**
   * Reverts the migration.
   *
   * Dropping the columns loses which picture each scope was showing. The
   * assets themselves survive in the registry, which is where the bytes and
   * the scan verdict live; what is lost is the pointer, and nothing else
   * records it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of SCOPE_TABLES) {
      await queryRunner.query(`
        ALTER TABLE "sto_info_app"."${table}"
          DROP CONSTRAINT "CHK_${table}_emblem_described",
          DROP CONSTRAINT "CHK_${table}_banner_described",
          DROP COLUMN "emblemImageAlt",
          DROP COLUMN "emblemImageId",
          DROP COLUMN "bannerImageAlt",
          DROP COLUMN "bannerImageId"
      `);
    }
  }
}
