import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a Fleet's Owner choose who may see each of its reports (FC-020).
 *
 * Plan R13: Admins choose public aggregates. Steve decided on 25 September
 * 2026 that the choice is made per report, by the Owner alone — the holder
 * of `scope.settings.manage` — and from the Fleet's own four audiences:
 *
 * - `PRIVATE`, the default, is the holders of `reports.view`: the Owner and
 *   the Admins, who see every report in full. For a report, it does not mean
 *   the Owner alone, as it does for a Fleet record.
 * - `FLEET_MEMBERS` is the Fleet's approved members too, who see it in full,
 *   since they can already read the roster it is built from.
 * - `COMMUNITY` and `PUBLIC` add the Community's followers, or anyone, who
 *   see aggregates only: no name, handle or comment, and nothing counting
 *   fewer than five members.
 *
 * `fleet_report_audience` is the choice now, one row per Fleet and report
 * once it has been made; a report with no row is `PRIVATE`. The reports are
 * FC-020's five from the roster history. Holdings, recruitment and attendance
 * add their values to `fleet_report_enum` with their stories.
 *
 * `fleet_report_audience_change` keeps each change, from what to what, who
 * made it and when, append-only and guarded like an import correction. No
 * reason is asked: the audience is one of the Owner's settings (Steve's
 * decision of 25 September 2026).
 */
export class CreateFleetReportAudiences1794700000000 implements MigrationInterface {
  name = 'CreateFleetReportAudiences1794700000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_report_enum" AS ENUM ('GROWTH', 'TENURE', 'RANKS', 'ACTIVITY', 'CONTRIBUTION')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_report_audience" (
      "fleetId" uuid NOT NULL,
      "report" "sto_info_app"."fleet_report_enum" NOT NULL,
      "audience" "sto_info_app"."fleet_audience_enum" NOT NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_fleet_report_audience" PRIMARY KEY ("fleetId", "report"),
      CONSTRAINT "FK_fleet_report_audience_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_report_audience_change" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "report" "sto_info_app"."fleet_report_enum" NOT NULL,
      "audienceBefore" "sto_info_app"."fleet_audience_enum" NOT NULL,
      "audienceAfter" "sto_info_app"."fleet_audience_enum" NOT NULL,
      "actorUserId" uuid,
      "changedAt" timestamptz NOT NULL DEFAULT now(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_fleet_report_audience_change" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_fleet_report_audience_change_moved" CHECK ("audienceBefore" <> "audienceAfter"),
      CONSTRAINT "FK_fleet_report_audience_change_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_report_audience_change_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_report_audience_change_fleet" ON "sto_info_app"."fleet_report_audience_change" ("fleetId", "changedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_report_audience_change_actor" ON "sto_info_app"."fleet_report_audience_change" ("actorUserId")`,
    );

    // The same rule as an import correction: the actor is the one column a
    // later event may change, when their account is deleted.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."fleet_report_audience_change_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId") THEN
          RAISE EXCEPTION 'fleet_report_audience_change is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_fleet_report_audience_change_guard" BEFORE UPDATE ON "sto_info_app"."fleet_report_audience_change" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."fleet_report_audience_change_guard"()`,
    );
  }

  /**
   * Reverts the migration. Every report goes back to private, since the
   * earlier schema has nowhere to keep an audience.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_fleet_report_audience_change_guard" ON "sto_info_app"."fleet_report_audience_change"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."fleet_report_audience_change_guard"()`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_report_audience_change"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_report_audience"`,
    );
    await queryRunner.query(`DROP TYPE "sto_info_app"."fleet_report_enum"`);
  }
}
