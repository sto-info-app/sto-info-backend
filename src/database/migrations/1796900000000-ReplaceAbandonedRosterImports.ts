import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an abandoned roster import be replaced (FC-050).
 *
 * One export is one import per Fleet (FC-017), so sending the same file
 * again answers with the import it already made. That is right for an import
 * in flight, in force, held or refused, and wrong for an abandoned one: it
 * was given up on before it was read, so answering with it would leave the
 * export unimportable for good. The page has always said that importing the
 * export again starts afresh; this makes it so.
 *
 * The abandoned import is not deleted. It is the record of an upload, and the
 * guard trigger exists because such a record is evidence. It is marked with
 * the moment it was replaced instead, and the uniqueness of Fleet and hash
 * holds only among imports not replaced, so the fresh one can be recorded
 * and two uploads racing to replace it still settle on one.
 */
export class ReplaceAbandonedRosterImports1796900000000 implements MigrationInterface {
  /**
   * Adds the column and narrows the unique index to imports not replaced.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" ADD "replacedAt" timestamptz NULL DEFAULT NULL`,
    );

    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UQ_roster_import_source_fleet_hash"`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_roster_import_source_fleet_hash"
        ON "sto_info_app"."fleet_roster_import_source" ("fleetId", "sourceSha256")
        WHERE "replacedAt" IS NULL`,
    );
  }

  /**
   * Restores the index over every import, and drops the column.
   *
   * Fails while a replaced import and its replacement share a hash, which is
   * the right outcome: rolling back would otherwise have to choose which of
   * two records of an upload to destroy.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UQ_roster_import_source_fleet_hash"`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_roster_import_source_fleet_hash"
        ON "sto_info_app"."fleet_roster_import_source" ("fleetId", "sourceSha256")`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source"
        DROP COLUMN "replacedAt"`,
    );
  }
}
