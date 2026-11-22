import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records when a roster export was taken, and on whose clock (FC-016/FC-017).
 *
 * An STO export writes wall-clock times in its filename and in every date
 * column and never says which zone they belong to. Until now the provenance
 * record kept what arrived and said nothing about when it was taken, which
 * makes two exports of the same Fleet unorderable — and the order of two
 * snapshots is the whole of a roster history.
 *
 * The zone is supplied by whoever uploads, once per file, and is kept
 * separately from every display and event timezone in the estate. Plan
 * section 3.4 is explicit about that separation: a Community's
 * `preferredTimezone` says when its events happen, and has nothing to do with
 * where somebody was sitting when they exported a CSV.
 *
 * ## Why the local stamp is kept as well as the instant
 *
 * Because the instant is an interpretation and the stamp is the observation.
 * A zone supplied wrongly is a correctable mistake only while the text it was
 * applied to still exists; recording the instant alone would make the error
 * indistinguishable from a real export four hours earlier.
 *
 * ## `exportedAtAmbiguous`
 *
 * On the morning the clocks go back, a stamp of `01:30` names two instants an
 * hour apart, and which one an export was taken at decides which of two
 * snapshots is the later. The uploader answers that explicitly, and this
 * column records that there was a question at all — an instant somebody chose
 * between two is a different kind of fact from one the file determined.
 *
 * ## Nullable
 *
 * Rows written before these columns existed have no answer, and inventing one
 * would defeat the purpose of a table that exists to say what was actually
 * uploaded. Every row written from here on carries all of them.
 *
 * **The write-once guard is replaced rather than left alone.** It names its
 * columns one by one, so a new column is mutable until it is listed, and a
 * piece of provenance that can be edited afterwards is not evidence. The
 * export instant is deliberately *not* guarded: plan section 3.6 allows a
 * timezone correction through a separate audited revision, and a column a
 * trigger refuses to change cannot be corrected by anything.
 */
export class RecordRosterExportTime1793400000000 implements MigrationInterface {
  name = 'RecordRosterExportTime1793400000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // One statement per column, matching the table's other migrations. The
    // alignment spec reads these back to hold the entity to them, and a
    // multi-column ALTER would hide every column after the first.
    const table = '"sto_info_app"."fleet_roster_import_source"';

    for (const column of [
      `"exportTimezone" varchar(64)`,
      `"exportLocalStamp" varchar(19)`,
      `"exportedAt" timestamptz`,
      `"exportedAtAmbiguous" boolean NOT NULL DEFAULT false`,
      `"filenameFleetLabel" varchar(255)`,
      `"matchedAliasId" uuid`,
    ]) {
      await queryRunner.query(`ALTER TABLE ${table} ADD ${column}`);
    }

    await queryRunner.query(
      `ALTER TABLE ${table}
        ADD CONSTRAINT "FK_roster_import_source_matched_alias"
        FOREIGN KEY ("matchedAliasId")
        REFERENCES "sto_info_app"."fleet_name_alias"("id")
        ON DELETE RESTRICT`,
    );

    // Two exports of one Fleet claiming the same instant are a conflict that
    // has to be found before either becomes effective, and ordering a Fleet's
    // history is the commonest read there is. One index answers both.
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_import_source_fleet_exported"
        ON "sto_info_app"."fleet_roster_import_source" ("fleetId", "exportedAt")`,
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
          OR NEW."filenameFleetLabel" IS DISTINCT FROM OLD."filenameFleetLabel"
          OR NEW."exportLocalStamp" IS DISTINCT FROM OLD."exportLocalStamp"
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

    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_roster_import_source_fleet_exported"`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source"
        DROP CONSTRAINT "FK_roster_import_source_matched_alias"`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source"
        DROP COLUMN "matchedAliasId",
        DROP COLUMN "filenameFleetLabel",
        DROP COLUMN "exportedAtAmbiguous",
        DROP COLUMN "exportedAt",
        DROP COLUMN "exportLocalStamp",
        DROP COLUMN "exportTimezone"`,
    );
  }
}
