import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which platforms the game provides a fleet roster export on
 * (FC-051).
 *
 * A fact about Star Trek Online rather than about this site. The export
 * exists on Windows and on neither console, so a Fleet recorded on a console
 * has no way to produce the CSV that every roster feature here reads. Until
 * now nothing knew that: the site offered the import against a console Fleet
 * and then showed it as never having imported one, which reads as a record
 * nobody is keeping rather than as a facility that does not exist.
 *
 * It lives on the catalogue rather than in a list in the code because it is
 * the game's answer and the game may change it. A console gaining the export
 * should be a row somebody updates, not a release.
 *
 * **The column defaults to false**, so a platform added later cannot import
 * until somebody has said it can. That is the safe way round: offering an
 * import that cannot work wastes somebody's afternoon collecting a file that
 * does not exist, while withholding one that could work is an `UPDATE` away
 * from being fixed.
 */
export class PlatformRosterExport1793200000000 implements MigrationInterface {
  name = 'PlatformRosterExport1793200000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."platform"
        ADD COLUMN "providesRosterExport" boolean NOT NULL DEFAULT false
    `);

    // By name, because that is the only stable handle a seeded catalogue row
    // has: its identifier is generated per environment. A database whose
    // Windows row has been renamed keeps the default and imports nothing,
    // which is the failure worth having of the two.
    await queryRunner.query(`
      UPDATE "sto_info_app"."platform"
         SET "providesRosterExport" = true
       WHERE "name" = 'Windows'
    `);
  }

  /**
   * Reverts the migration.
   *
   * Dropping the column loses nothing that cannot be restated: which
   * platforms have the export is a published fact about the game rather than
   * anything this site collected.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."platform"
        DROP COLUMN "providesRosterExport"
    `);
  }
}
