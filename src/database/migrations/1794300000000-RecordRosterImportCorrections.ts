import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an investigator correct what a Fleet's roster history is built from,
 * and keeps a record of every correction (FC-019).
 *
 * Plan section 3.6 keeps every import as evidence, whatever happens to it
 * afterwards. A correction therefore never deletes or rewrites an
 * observation's values; it changes whether, and how, the evidence counts.
 *
 * ## What can be corrected
 *
 * - **An import can be excluded**, and reinstated. It stays in force as a
 *   file and leaves every derived result: `excluded` on the import.
 * - **An import can be marked partial.** Its rows still say who was there,
 *   but nobody missing from it is taken to have left: `partial`.
 * - **A row can be excluded.** The member it names is unknown in that export,
 *   never absent: `excluded` on the observation.
 * - **A conflict group can be settled** by selecting the export that stands:
 *   `selectedImportId`. The choice can be changed, so the column is the
 *   current selection and the action log below is its history.
 * - **An export's timezone can be corrected.** The import's own zone and
 *   instant columns are not write-once, so the correction rewrites them and
 *   the log keeps what they were.
 *
 * ## One group per Fleet and instant, ever
 *
 * Steve decided on 25 September 2026 that an export arriving for an instant
 * whose group was already settled reopens that group, rather than starting
 * another beside it, so the selection already made stays in force while the
 * newcomer waits. The partial unique index on open groups becomes a plain
 * one. Nothing has settled a group before this migration, so no Fleet has
 * two groups for one instant for it to trip over.
 *
 * ## The selection is a member, by key
 *
 * `FK_roster_import_conflict_selected` refers to the import through
 * `(id, conflictGroupId)`, so a group can only select an import that is in
 * it. A settled group always has a selection; a reopened one keeps the one
 * it had, which is why the check runs one way only.
 *
 * ## Every correction is written down, once
 *
 * `fleet_roster_import_action` is append-only, guarded like the identity
 * decisions: the actor may be cleared when their account goes, and nothing
 * else may change. A reason is required and may not be blank — Steve's
 * decision of 25 September 2026 — because a history somebody changed with
 * no word of why is not one anybody else can trust.
 */
export class RecordRosterImportCorrections1794300000000 implements MigrationInterface {
  name = 'RecordRosterImportCorrections1794300000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" ADD "excluded" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" ADD "partial" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_observation" ADD "excluded" boolean NOT NULL DEFAULT false`,
    );

    // The target of the selection's composite key. The primary key already
    // makes the pair unique; PostgreSQL wants it said.
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" ADD CONSTRAINT "UQ_roster_import_source_conflict_member" UNIQUE ("id", "conflictGroupId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_conflict" ADD "selectedImportId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_conflict"
        ADD CONSTRAINT "FK_roster_import_conflict_selected"
        FOREIGN KEY ("selectedImportId", "id")
        REFERENCES "sto_info_app"."fleet_roster_import_source"("id", "conflictGroupId")
        ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_conflict"
        ADD CONSTRAINT "CHK_roster_import_conflict_selected"
        CHECK ("resolvedAt" IS NULL OR "selectedImportId" IS NOT NULL)`,
    );

    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_roster_import_conflict_open"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_roster_import_conflict_instant" ON "sto_info_app"."fleet_roster_import_conflict" ("fleetId", "exportedAt")`,
    );

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_import_action_enum" AS ENUM ('EXCLUDED', 'REINSTATED', 'MARKED_PARTIAL', 'UNMARKED_PARTIAL', 'ROWS_EXCLUDED', 'ROWS_REINSTATED', 'TIMEZONE_CORRECTED', 'CONFLICT_SELECTED')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_import_action" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "importSourceId" uuid NOT NULL,
      "conflictGroupId" uuid,
      "action" "sto_info_app"."roster_import_action_enum" NOT NULL,
      "actorUserId" uuid,
      "reason" varchar(500) NOT NULL,
      "detail" jsonb,
      "actedAt" timestamptz NOT NULL DEFAULT now(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_import_action" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_roster_import_action_reason" CHECK (length(btrim("reason")) > 0),
      CONSTRAINT "CHK_roster_import_action_conflict" CHECK (("action" = 'CONFLICT_SELECTED') = ("conflictGroupId" IS NOT NULL)),
      CONSTRAINT "FK_roster_import_action_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_import_action_import" FOREIGN KEY ("importSourceId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_import_action_conflict" FOREIGN KEY ("conflictGroupId") REFERENCES "sto_info_app"."fleet_roster_import_conflict"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_import_action_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE INDEX "IDX_roster_import_action_import" ON "sto_info_app"."fleet_roster_import_action" ("importSourceId", "actedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_import_action_fleet" ON "sto_info_app"."fleet_roster_import_action" ("fleetId", "actedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_import_action_conflict" ON "sto_info_app"."fleet_roster_import_action" ("conflictGroupId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_import_action_actor" ON "sto_info_app"."fleet_roster_import_action" ("actorUserId")`,
    );

    // The same rule as an identity decision: the actor is the one column a
    // later event may change, when their account is deleted.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."roster_import_action_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId") THEN
          RAISE EXCEPTION 'fleet_roster_import_action is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_roster_import_action_guard" BEFORE UPDATE ON "sto_info_app"."fleet_roster_import_action" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."roster_import_action_guard"()`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Loses every correction and selection, which is what reverting it means:
   * the earlier schema has nowhere to keep them. The partial index comes back
   * without trouble, since the plain one it replaced was stricter.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_roster_import_action_guard" ON "sto_info_app"."fleet_roster_import_action"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."roster_import_action_guard"()`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_import_action"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_import_action_enum"`,
    );

    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_roster_import_conflict_instant"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_roster_import_conflict_open" ON "sto_info_app"."fleet_roster_import_conflict" ("fleetId", "exportedAt") WHERE "resolvedAt" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_conflict" DROP CONSTRAINT "CHK_roster_import_conflict_selected"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_conflict" DROP CONSTRAINT "FK_roster_import_conflict_selected"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_conflict" DROP COLUMN "selectedImportId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" DROP CONSTRAINT "UQ_roster_import_source_conflict_member"`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_observation" DROP COLUMN "excluded"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" DROP COLUMN "partial"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" DROP COLUMN "excluded"`,
    );
  }
}
