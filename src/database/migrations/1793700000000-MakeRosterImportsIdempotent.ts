import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes one export one import, per Fleet (FC-017).
 *
 * Uploading the same file to the same Fleet twice is ordinary: a browser
 * retries, a wizard is submitted twice, somebody is unsure whether the first
 * attempt worked. The answer each time has to be the import the first
 * attempt made, and the only answer that holds when two of those attempts
 * arrive together is one the database gives. So the index that already
 * served the lookup becomes a unique one, and the second of two racing
 * uploads is refused by the insert rather than by a check that both of them
 * passed.
 *
 * The key is the Fleet and the hash of the bytes *received*, not of the bytes
 * kept. Two uploads that differ only in their officer notes sanitise to the
 * same file and are still two uploads, and a hash of what was sent is the
 * only thing that says whether an uploader has sent this before.
 *
 * It is per Fleet, and deliberately nothing wider. A lookup that crossed
 * Fleets would answer "somebody has already imported this" to a person with
 * no right to know that anybody had.
 */
export class MakeRosterImportsIdempotent1793700000000 implements MigrationInterface {
  /**
   * Replaces the lookup index with a unique one.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_roster_import_source_fleet_hash"`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_roster_import_source_fleet_hash"
        ON "sto_info_app"."fleet_roster_import_source" ("fleetId", "sourceSha256")`,
    );
  }

  /**
   * Restores the plain lookup index.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UQ_roster_import_source_fleet_hash"`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_roster_import_source_fleet_hash"
        ON "sto_info_app"."fleet_roster_import_source" ("fleetId", "sourceSha256")`,
    );
  }
}
