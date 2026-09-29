import { MigrationInterface, QueryRunner } from 'typeorm';

/** A type this migration adds values to, and the values it had before. */
interface Extended {
  readonly type: string;
  readonly table: string;
  readonly previous: readonly string[];
  readonly added: readonly string[];
  /** Its table's CHECKs on the column, dropped and remade around a change. */
  readonly checks: ReadonlyArray<readonly [string, string]>;
}

/** The two logs that learn about retention. */
const EXTENDED: readonly Extended[] = [
  {
    type: 'moderation_hold_action_kind_enum',
    table: 'moderation_hold_action',
    previous: ['PLACED', 'EXTENDED', 'RELEASED', 'READ'],
    added: ['REVIEW_DUE', 'RELEASE_WARNED'],
    checks: [],
  },
  {
    type: 'roster_import_action_enum',
    table: 'fleet_roster_import_action',
    previous: [
      'EXCLUDED',
      'REINSTATED',
      'MARKED_PARTIAL',
      'UNMARKED_PARTIAL',
      'ROWS_EXCLUDED',
      'ROWS_REINSTATED',
      'TIMEZONE_CORRECTED',
      'CONFLICT_SELECTED',
    ],
    added: ['SOURCE_EXPIRED'],
    checks: [
      [
        'CHK_roster_import_action_conflict',
        `("action" = 'CONFLICT_SELECTED') = ("conflictGroupId" IS NOT NULL)`,
      ],
    ],
  },
];

/** Every job whose runs are recorded. */
const JOBS = [
  'ROSTER_SOURCES',
  'NEWS_POSTS',
  'CHARACTER_FLEET_MEMBERSHIPS',
  'CHAT_MESSAGES',
  'CHAT_REPORTS',
  'CHAT_TRANSCRIPTS',
  'ACTIVITY',
  'MODERATION_HOLDS',
  'RETENTION_RUNS',
];

/**
 * Retention and purge jobs (FC-037).
 *
 * With Steve's decisions of 29 September 2026:
 *
 * - **Runs.** `retention_run` records each run of each Fleet retention job:
 *   when it started and finished, what it deleted, whether it got through
 *   everything due, and why it stopped when it failed. A run is finished
 *   once; after that its row is write-once. Runs are kept a year.
 * - **Holds.** A hold whose review date passes tells its owner
 *   (`REVIEW_DUE`), every site admin a week before it is released
 *   (`RELEASE_WARNED`), and is released by the system 14 days after the
 *   date when nobody has extended it, logged as a release with no actor.
 * - **Roster sources.** A held import whose file expires before anybody
 *   selected it is retired, and its log says so (`SOURCE_EXPIRED`).
 */
export class AddRetentionRuns1796400000000 implements MigrationInterface {
  name = 'AddRetentionRuns1796400000000';

  /**
   * Adds the runs table and the two logs' new values.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const extended of EXTENDED) {
      for (const value of extended.added) {
        await queryRunner.query(
          `ALTER TYPE "sto_info_app"."${extended.type}" ADD VALUE IF NOT EXISTS '${value}'`,
        );
      }
    }

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."retention_job_enum" AS ENUM (${JOBS.map(job => `'${job}'`).join(', ')})`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."retention_run" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "job" "sto_info_app"."retention_job_enum" NOT NULL,
      "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "finishedAt" TIMESTAMP WITH TIME ZONE,
      "complete" boolean,
      "counts" jsonb,
      "error" varchar(500),
      CONSTRAINT "PK_retention_run" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_retention_run_finished" CHECK (("finishedAt" IS NULL) = ("complete" IS NULL)),
      CONSTRAINT "CHK_retention_run_error" CHECK ("error" IS NULL OR ("finishedAt" IS NOT NULL AND NOT "complete")))`);
    await queryRunner.query(
      `CREATE INDEX "IDX_retention_run_job" ON "sto_info_app"."retention_run" ("job", "startedAt")`,
    );
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."retention_run_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF OLD."finishedAt" IS NOT NULL
          OR NEW."job" IS DISTINCT FROM OLD."job"
          OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
          RAISE EXCEPTION 'retention_run is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_retention_run_guard" BEFORE UPDATE ON "sto_info_app"."retention_run" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."retention_run_guard"()`,
    );
  }

  /**
   * Reverts the migration: the runs go, and the two logs forget retention.
   * PostgreSQL cannot take a value out of a type, so each type is made again
   * without them, its CHECKs dropped and remade around the change. Both logs
   * are write-once against updates only, so their rows can be deleted.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sto_info_app"."retention_run"`);
    await queryRunner.query(
      `DROP FUNCTION "sto_info_app"."retention_run_guard"()`,
    );
    await queryRunner.query(`DROP TYPE "sto_info_app"."retention_job_enum"`);

    for (const extended of EXTENDED) {
      const table = `"sto_info_app"."${extended.table}"`;
      const type = `"sto_info_app"."${extended.type}"`;
      const added = extended.added.map(value => `'${value}'`).join(', ');
      const previous = extended.previous.map(value => `'${value}'`).join(', ');

      for (const [name] of extended.checks) {
        await queryRunner.query(
          `ALTER TABLE ${table} DROP CONSTRAINT "${name}"`,
        );
      }

      await queryRunner.query(
        `DELETE FROM ${table} WHERE "action"::text IN (${added})`,
      );
      await queryRunner.query(
        `ALTER TYPE ${type} RENAME TO "${extended.type}_old"`,
      );
      await queryRunner.query(`CREATE TYPE ${type} AS ENUM (${previous})`);
      await queryRunner.query(
        `ALTER TABLE ${table} ALTER COLUMN "action" TYPE ${type} USING "action"::text::${type}`,
      );
      await queryRunner.query(
        `DROP TYPE "sto_info_app"."${extended.type}_old"`,
      );

      for (const [name, check] of extended.checks) {
        await queryRunner.query(
          `ALTER TABLE ${table} ADD CONSTRAINT "${name}" CHECK (${check})`,
        );
      }
    }
  }
}
