import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserReporting1786233600000 implements MigrationInterface {
  name = 'CreateUserReporting1786233600000';

  /**
   * Applies the migration to the database.
   *
   * Adds `user_report`, the queue behind member-submitted reports of other
   * members, and the three columns on `user` that record why and when an
   * administrator disabled an account — `isAccountDisabled` already existed but
   * carried no explanation, which is the first thing a reviewer asks.
   *
   * Reports soft-delete, so the one-live-report-per-pair guarantee is a partial
   * index scoped to live rows in an unresolved state: once a report is actioned
   * or dismissed the pair is free again, letting a reporter raise a fresh report
   * about new conduct.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "sto_info_app"."report_reason_enum"
      AS ENUM (
        'HARASSMENT',
        'HATE_SPEECH',
        'SPAM',
        'IMPERSONATION',
        'INAPPROPRIATE_CONTENT',
        'OTHER'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "sto_info_app"."report_status_enum"
      AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACTIONED', 'DISMISSED')
    `);

    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."user_report" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "reporterId" uuid NOT NULL,
        "reportedId" uuid NOT NULL,
        "reason" "sto_info_app"."report_reason_enum" NOT NULL,
        "details" character varying(1000),
        "status" "sto_info_app"."report_status_enum" NOT NULL DEFAULT 'OPEN',
        "moderatorNotes" character varying(2000),
        "reviewedById" uuid,
        "reviewedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_user_report" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_user_report_not_self" CHECK ("reporterId" <> "reportedId"),
        CONSTRAINT "FK_user_report_reporter" FOREIGN KEY ("reporterId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_report_reported" FOREIGN KEY ("reportedId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_report_reviewed_by" FOREIGN KEY ("reviewedById")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `);

    // One unresolved report per reporter/reported pair, so a member cannot
    // flood the queue with duplicates of the same complaint. Resolved reports
    // are excluded, leaving the pair free for a genuinely new report later.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_user_report_open_pair"
      ON "sto_info_app"."user_report" ("reporterId", "reportedId")
      WHERE "deletedAt" IS NULL AND "status" IN ('OPEN', 'UNDER_REVIEW')
    `);

    // The queue is read by status ("what is still open?") and, once an
    // administrator opens a member, by the member the reports are about.
    await queryRunner.query(`
      CREATE INDEX "IDX_user_report_status"
      ON "sto_info_app"."user_report" ("status", "createdAt")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_user_report_reported"
      ON "sto_info_app"."user_report" ("reportedId")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_user_report_reporter"
      ON "sto_info_app"."user_report" ("reporterId")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."user"
        ADD "disabledAt" TIMESTAMP,
        ADD "disabledReason" character varying(500),
        ADD "disabledById" uuid,
        ADD CONSTRAINT "FK_user_disabled_by" FOREIGN KEY ("disabledById")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."user"
        DROP CONSTRAINT "FK_user_disabled_by",
        DROP COLUMN "disabledById",
        DROP COLUMN "disabledReason",
        DROP COLUMN "disabledAt"
    `);
    await queryRunner.query(`DROP TABLE "sto_info_app"."user_report"`);
    await queryRunner.query(`DROP TYPE "sto_info_app"."report_status_enum"`);
    await queryRunner.query(`DROP TYPE "sto_info_app"."report_reason_enum"`);
  }
}
