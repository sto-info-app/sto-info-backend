import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the roster import provenance record (FC-009).
 *
 * One table and one enum type. It is what remains of an uploaded export once
 * the export itself has been discarded: ADR-0001 names the original filename,
 * the source hash, the sanitised hash and the parser version as the things
 * that must survive, and this is where the two hashes and the version live.
 *
 * **The source hash is kept when the source is not.** That is the whole point
 * of the row. It answers "is this the same export you sent before" and "has
 * this already been imported" without a byte of the file surviving, and a
 * SHA-256 tells nobody anything they could not already compute from a file
 * they hold.
 *
 * Three things here are database rules rather than service checks.
 *
 * **Provenance is write-once.** `roster_import_source_guard` refuses a change
 * to the asset, the Fleet, either hash, the filename or the parser version.
 * This row is the answer to "what was actually uploaded", and an answer that
 * can be edited afterwards is not evidence. Nothing about the row is intended
 * to change, so the trigger is broad on purpose; the counts and the timestamps
 * are left mutable only because a later correction to a count is a correction
 * to a derived figure, not to the record of the upload.
 *
 * **One row per asset.** A unique constraint rather than an index on a
 * nullable column, because an asset of kind `ROSTER_IMPORT_SOURCE` with two
 * provenance rows would mean two answers to which file it came from.
 *
 * **The officer tail count cannot exceed the row count.** A cheap constraint
 * that catches the one arithmetic error this table could plausibly carry, and
 * the figure is a count and never a value — it is what lets an administrator
 * see how much of the estate is officer-visible without reading a note.
 *
 * Both foreign keys to durable objects are `ON DELETE RESTRICT`. The asset row
 * is what tells the cleanup cron an object exists and this row is what tells
 * an investigator where it came from; neither may be removed while the other
 * is meaningful. The uploader is `ON DELETE SET NULL`, matching `file_asset`:
 * deleting an account severs the personal link and does not destroy the
 * evidence that an import happened.
 */
export class CreateRosterImportSource1792300000000 implements MigrationInterface {
  name = 'CreateRosterImportSource1792300000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_source_header_shape_enum" AS ENUM ('NORMAL', 'OFFICER')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_import_source" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "assetId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "uploadedByUserId" uuid,
      "originalFilename" varchar(512) NOT NULL,
      "sourceSha256" char(64) NOT NULL,
      "sanitisedSha256" char(64) NOT NULL,
      "sourceByteSize" bigint NOT NULL,
      "sanitisedByteSize" bigint NOT NULL,
      "sourceHeaderShape" "sto_info_app"."roster_source_header_shape_enum" NOT NULL,
      "rowCount" int NOT NULL,
      "officerTailRowCount" int NOT NULL,
      "parserVersion" int NOT NULL,
      "uploadedAt" timestamptz NOT NULL DEFAULT now(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_import_source" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_roster_import_source_asset" UNIQUE ("assetId"),
      CONSTRAINT "CHK_roster_import_source_source_hash" CHECK ("sourceSha256" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "CHK_roster_import_source_sanitised_hash" CHECK ("sanitisedSha256" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "CHK_roster_import_source_source_size" CHECK ("sourceByteSize" > 0),
      CONSTRAINT "CHK_roster_import_source_sanitised_size" CHECK ("sanitisedByteSize" > 0),
      CONSTRAINT "CHK_roster_import_source_row_count" CHECK ("rowCount" >= 0),
      CONSTRAINT "CHK_roster_import_source_officer_rows" CHECK ("officerTailRowCount" >= 0 AND "officerTailRowCount" <= "rowCount"),
      CONSTRAINT "CHK_roster_import_source_officer_shape" CHECK ("sourceHeaderShape" = 'OFFICER' OR "officerTailRowCount" = 0),
      CONSTRAINT "CHK_roster_import_source_parser_version" CHECK ("parserVersion" >= 1),
      CONSTRAINT "CHK_roster_import_source_filename" CHECK (length(btrim("originalFilename")) > 0),
      CONSTRAINT "FK_roster_import_source_asset" FOREIGN KEY ("assetId") REFERENCES "sto_info_app"."file_asset"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_import_source_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_import_source_user" FOREIGN KEY ("uploadedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    // An investigator asks "what has this Fleet uploaded, most recent first".
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_import_source_fleet_uploaded" ON "sto_info_app"."fleet_roster_import_source" ("fleetId", "uploadedAt")`,
    );

    // FC-017 asks "has this Fleet already had this exact file". Scoped to the
    // Fleet rather than global on purpose: a global lookup on the source hash
    // would answer whether some *other* Community had uploaded the same
    // export, which is a cross-tenant existence leak. Plan section 3.6.
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_import_source_fleet_hash" ON "sto_info_app"."fleet_roster_import_source" ("fleetId", "sourceSha256")`,
    );

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
      `CREATE TRIGGER "TR_roster_import_source_guard" BEFORE UPDATE ON "sto_info_app"."fleet_roster_import_source" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."roster_import_source_guard"()`,
    );
  }

  /**
   * Reverts the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_roster_import_source_guard" ON "sto_info_app"."fleet_roster_import_source"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."roster_import_source_guard"()`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_import_source"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_source_header_shape_enum"`,
    );
  }
}
