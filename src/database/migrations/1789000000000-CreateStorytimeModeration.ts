import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeModeration1789000000000 implements MigrationInterface {
  name = 'CreateStorytimeModeration1789000000000';

  /**
   * Applies the migration to the database.
   *
   * Adds the three tables moderation runs on: what readers reported, what
   * administrators did about it, and what creators said in reply.
   *
   * `storytime_moderation_action` is append-only and carries no soft delete:
   * an audit trail that can be edited answers "what do we say happened"
   * rather than "what happened". It keeps no foreign key to the content
   * either, because the history of a removal has to survive the content being
   * deleted afterwards — which is exactly when somebody will ask about it.
   *
   * Report status reuses the site's existing `report_status_enum` rather than
   * declaring a parallel one. A report about a Story and a report about a
   * member move through the same queue in the same states, and two enums that
   * must always agree eventually will not.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_report_reason_enum" AS ENUM (
        'HARASSMENT', 'HATE_CONTENT', 'EXPLICIT_CONTENT', 'GRAPHIC_VIOLENCE',
        'PLAGIARISM', 'IMPERSONATION', 'PERSONAL_INFORMATION', 'COPYRIGHT',
        'SPAM', 'MALICIOUS_LINK', 'DECEPTIVE_MEDIA', 'OTHER'
      )
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_moderation_action_enum" AS ENUM (
        'REMOVED', 'RESTORED', 'REPORT_RESOLVED', 'APPEAL_UPHELD',
        'APPEAL_REJECTED'
      )
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_appeal_status_enum" AS ENUM (
        'SUBMITTED', 'UPHELD', 'REJECTED', 'WITHDRAWN'
      )
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_report" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "reporterUserId" uuid NOT NULL,
        "targetType" "sto_info_app"."storytime_target_type_enum" NOT NULL,
        "targetId" uuid NOT NULL,
        "reasonCode" "sto_info_app"."storytime_report_reason_enum" NOT NULL,
        "description" character varying(2000),
        "status" "sto_info_app"."report_status_enum" NOT NULL DEFAULT 'OPEN',
        "assignedToUserId" uuid,
        "resolution" character varying(1000),
        "resolvedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_storytime_report" PRIMARY KEY ("id"),
        CONSTRAINT "FK_storytime_report_reporter" FOREIGN KEY ("reporterUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_report_assigned_to" FOREIGN KEY ("assignedToUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,

      // One live report per reporter per item, so the queue cannot be flooded
      // with the same complaint. Resolving it frees them to report the item
      // again about something new.
      `
      CREATE UNIQUE INDEX "UQ_storytime_report_one_live_per_target"
      ON "sto_info_app"."storytime_report" ("reporterUserId", "targetType", "targetId")
      WHERE "deletedAt" IS NULL AND "status" IN ('OPEN', 'UNDER_REVIEW')
    `,

      // Drives the queue: open work first, oldest first.
      `
      CREATE INDEX "IDX_storytime_report_queue"
      ON "sto_info_app"."storytime_report" ("status", "createdAt")
    `,

      // Drives "what has been said about this item".
      `
      CREATE INDEX "IDX_storytime_report_target"
      ON "sto_info_app"."storytime_report" ("targetType", "targetId")
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_moderation_action" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "targetType" "sto_info_app"."storytime_target_type_enum" NOT NULL,
        "targetId" uuid NOT NULL,
        "action" "sto_info_app"."storytime_moderation_action_enum" NOT NULL,
        "actorUserId" uuid NOT NULL,
        "reasonCode" character varying(100),
        "message" character varying(1000),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_moderation_action" PRIMARY KEY ("id"),
        CONSTRAINT "FK_storytime_moderation_action_actor" FOREIGN KEY ("actorUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE
      )
    `,

      `
      CREATE INDEX "IDX_storytime_moderation_action_target"
      ON "sto_info_app"."storytime_moderation_action" ("targetType", "targetId", "createdAt")
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_moderation_appeal" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "targetType" "sto_info_app"."storytime_target_type_enum" NOT NULL,
        "targetId" uuid NOT NULL,
        "appellantUserId" uuid NOT NULL,
        "body" character varying(2000) NOT NULL,
        "status" "sto_info_app"."storytime_appeal_status_enum" NOT NULL DEFAULT 'SUBMITTED',
        "reviewedByUserId" uuid,
        "reviewedAt" TIMESTAMP,
        "reviewNotes" character varying(1000),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_moderation_appeal" PRIMARY KEY ("id"),
        CONSTRAINT "FK_storytime_appeal_appellant" FOREIGN KEY ("appellantUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_appeal_reviewer" FOREIGN KEY ("reviewedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,

      // One appeal per removed item, but a withdrawn one frees the creator to
      // put a better argument: withdrawing is not spending the appeal.
      `
      CREATE UNIQUE INDEX "UQ_storytime_appeal_one_per_target"
      ON "sto_info_app"."storytime_moderation_appeal"
      ("targetType", "targetId", "appellantUserId")
      WHERE "status" IN ('SUBMITTED', 'UPHELD', 'REJECTED')
    `,

      `
      CREATE INDEX "IDX_storytime_appeal_queue"
      ON "sto_info_app"."storytime_moderation_appeal" ("status", "createdAt")
    `,
    ]);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `DROP TABLE "sto_info_app"."storytime_moderation_appeal"`,
      `DROP TABLE "sto_info_app"."storytime_moderation_action"`,
      `DROP TABLE "sto_info_app"."storytime_report"`,
      `DROP TYPE "sto_info_app"."storytime_appeal_status_enum"`,
      `DROP TYPE "sto_info_app"."storytime_moderation_action_enum"`,
      `DROP TYPE "sto_info_app"."storytime_report_reason_enum"`,
    ]);
  }

  /**
   * Executes migration queries in the given order.
   *
   * @param queryRunner - The TypeORM query runner.
   * @param queries - SQL statements to execute.
   */
  private async executeQueries(
    queryRunner: QueryRunner,
    queries: string[],
  ): Promise<void> {
    for (const query of queries) {
      await queryRunner.query(query);
    }
  }
}
