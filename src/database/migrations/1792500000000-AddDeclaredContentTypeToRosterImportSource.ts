import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keeps what a roster upload said it was sending (FC-011).
 *
 * The asset a roster import registers is **not the file that arrived**. It is
 * the sanitised CSV this application serialised after discarding the officer
 * columns, so its declared type is now stated as `text/csv` — a claim the
 * backend is entitled to make about bytes it wrote itself, and one the worker
 * can check against them. ADR-0020.
 *
 * That leaves the uploader's own `Content-Type` with nowhere to live, and the
 * provenance record is where it belongs: this table exists to answer "what was
 * actually uploaded" once the upload is gone. It is stored exactly as it
 * arrived, bounded in length and believed by nothing — a browser's idea of
 * what a CSV is comes from a file association, and `text/csv`,
 * `application/vnd.ms-excel` and `application/octet-stream` are all common for
 * the same file.
 *
 * Nullable, because rows written before this column existed have no answer
 * and inventing one would defeat the purpose of the table.
 *
 * **The write-once guard is replaced rather than left alone.** It names its
 * columns one by one, so a new column is mutable until it is listed — and a
 * piece of provenance that can be edited afterwards is not evidence.
 */
export class AddDeclaredContentTypeToRosterImportSource1792500000000 implements MigrationInterface {
  name = 'AddDeclaredContentTypeToRosterImportSource1792500000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" ADD "declaredContentType" varchar(255)`,
    );

    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."roster_import_source_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."assetId" IS DISTINCT FROM OLD."assetId"
          OR NEW."fleetId" IS DISTINCT FROM OLD."fleetId"
          OR NEW."originalFilename" IS DISTINCT FROM OLD."originalFilename"
          OR NEW."declaredContentType" IS DISTINCT FROM OLD."declaredContentType"
          OR NEW."sourceSha256" IS DISTINCT FROM OLD."sourceSha256"
          OR NEW."sanitisedSha256" IS DISTINCT FROM OLD."sanitisedSha256"
          OR NEW."sourceByteSize" IS DISTINCT FROM OLD."sourceByteSize"
          OR NEW."sanitisedByteSize" IS DISTINCT FROM OLD."sanitisedByteSize"
          OR NEW."sourceHeaderShape" IS DISTINCT FROM OLD."sourceHeaderShape"
          OR NEW."parserVersion" IS DISTINCT FROM OLD."parserVersion"
          OR NEW."uploadedAt" IS DISTINCT FROM OLD."uploadedAt" THEN
          RAISE EXCEPTION 'fleet_roster_import_source provenance is write-once' USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
  }

  /**
   * Reverses the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."roster_import_source_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."assetId" IS DISTINCT FROM OLD."assetId"
          OR NEW."fleetId" IS DISTINCT FROM OLD."fleetId"
          OR NEW."originalFilename" IS DISTINCT FROM OLD."originalFilename"
          OR NEW."sourceSha256" IS DISTINCT FROM OLD."sourceSha256"
          OR NEW."sanitisedSha256" IS DISTINCT FROM OLD."sanitisedSha256"
          OR NEW."sourceByteSize" IS DISTINCT FROM OLD."sourceByteSize"
          OR NEW."sanitisedByteSize" IS DISTINCT FROM OLD."sanitisedByteSize"
          OR NEW."sourceHeaderShape" IS DISTINCT FROM OLD."sourceHeaderShape"
          OR NEW."parserVersion" IS DISTINCT FROM OLD."parserVersion"
          OR NEW."uploadedAt" IS DISTINCT FROM OLD."uploadedAt" THEN
          RAISE EXCEPTION 'fleet_roster_import_source provenance is write-once' USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" DROP COLUMN "declaredContentType"`,
    );
  }
}
