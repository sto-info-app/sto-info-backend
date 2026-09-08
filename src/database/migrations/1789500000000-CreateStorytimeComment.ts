import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeComment1789500000000 implements MigrationInterface {
  name = 'CreateStorytimeComment1789500000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `storytime_comment`: discussion on Stories, Chapters and Arcs.
   *
   * Replies point at a parent comment, and the application allows only one
   * level of them. A thread that can nest indefinitely becomes unreadable on a
   * phone and unmoderatable anywhere.
   *
   * A silenced comment keeps its row and changes status rather than being
   * deleted, because deleting it would take its replies with it and leave the
   * conversation full of holes. The status says who silenced it: the author,
   * the owner of the content, or an administrator.
   *
   * Bodies are plain text. Storytime already renders Markdown in Chapters
   * through a sanitiser, and extending that to every comment would widen the
   * attack surface for the sake of italics in a reply.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_comment_status_enum" AS ENUM (
        'VISIBLE', 'DELETED_BY_AUTHOR', 'HIDDEN_BY_OWNER', 'REMOVED_BY_ADMIN'
      )
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_comment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "targetType" "sto_info_app"."storytime_target_type_enum" NOT NULL,
        "targetId" uuid NOT NULL,
        "authorUserId" uuid NOT NULL,
        "parentCommentId" uuid,
        "body" character varying(2000) NOT NULL,
        "status" "sto_info_app"."storytime_comment_status_enum"
          NOT NULL DEFAULT 'VISIBLE',
        "editedAt" TIMESTAMP,
        "moderationMessage" character varying(1000),
        "moderatedByUserId" uuid,
        "moderatedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_comment" PRIMARY KEY ("id"),
        CONSTRAINT "FK_storytime_comment_author" FOREIGN KEY ("authorUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_comment_moderator" FOREIGN KEY ("moderatedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_storytime_comment_parent" FOREIGN KEY ("parentCommentId")
          REFERENCES "sto_info_app"."storytime_comment" ("id") ON DELETE CASCADE
      )
    `,

      // Drives the only read a page makes: the whole conversation on one
      // piece of content, oldest first.
      `
      CREATE INDEX "IDX_storytime_comment_thread"
      ON "sto_info_app"."storytime_comment" ("targetType", "targetId", "createdAt")
    `,

      // Drives "what has this person said", which moderation asks about a
      // reported account.
      `
      CREATE INDEX "IDX_storytime_comment_author"
      ON "sto_info_app"."storytime_comment" ("authorUserId", "createdAt")
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
      `DROP TABLE "sto_info_app"."storytime_comment"`,
      `DROP TYPE "sto_info_app"."storytime_comment_status_enum"`,
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
