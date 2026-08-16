import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeProgress1788100000000 implements MigrationInterface {
  name = 'CreateStorytimeProgress1788100000000';

  /**
   * Applies the migration to the database.
   *
   * Adds the two tables holding reader progress: one row per reader per Story,
   * and one per reader per Chapter.
   *
   * Both are unique on the reader and their target, which is what makes
   * progress writes idempotent — a client that retries or double-fires while
   * somebody scrolls updates the same row rather than accumulating duplicates.
   *
   * Neither table soft-deletes. Progress is a fact about a reader, not content
   * to be moderated, and resetting it is a deletion the reader asked for.
   *
   * `knownPublishedChapterCount` on the Story row records how many published
   * Chapters existed when the reader was last up to date. It is what allows
   * "new Chapters since you finished" to be answered without pushing anything
   * to the reader when a Chapter is published.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_reader_story_status_enum"
      AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'ABANDONED')
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_reader_chapter_status_enum"
      AS ENUM ('UNREAD', 'IN_PROGRESS', 'READ')
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_user_story_progress" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "storyId" uuid NOT NULL,
        "status" "sto_info_app"."storytime_reader_story_status_enum" NOT NULL DEFAULT 'NOT_STARTED',
        "lastReadChapterId" uuid,
        "startedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "lastReadAt" TIMESTAMP,
        "completedChapterCount" integer NOT NULL DEFAULT 0,
        "knownPublishedChapterCount" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_user_story_progress" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_storytime_user_story_progress" UNIQUE ("userId", "storyId"),
        CONSTRAINT "CHK_storytime_user_story_progress_counts"
          CHECK ("completedChapterCount" >= 0 AND "knownPublishedChapterCount" >= 0),
        CONSTRAINT "FK_storytime_user_story_progress_user" FOREIGN KEY ("userId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_user_story_progress_story" FOREIGN KEY ("storyId")
          REFERENCES "sto_info_app"."storytime_story" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_user_story_progress_chapter" FOREIGN KEY ("lastReadChapterId")
          REFERENCES "sto_info_app"."storytime_chapter" ("id") ON DELETE SET NULL
      )
    `,
      // The reader's library is filtered by status, which is the only query
      // this table serves in bulk.
      `
      CREATE INDEX "IDX_storytime_user_story_progress_library"
      ON "sto_info_app"."storytime_user_story_progress" ("userId", "status")
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_user_chapter_progress" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "chapterId" uuid NOT NULL,
        "storyId" uuid NOT NULL,
        "status" "sto_info_app"."storytime_reader_chapter_status_enum" NOT NULL DEFAULT 'UNREAD',
        "lastPositionType" character varying(30),
        "lastPositionValue" character varying(255),
        "progressPercent" numeric(5,2),
        "startedAt" TIMESTAMP,
        "readAt" TIMESTAMP,
        "lastReadAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_user_chapter_progress" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_storytime_user_chapter_progress" UNIQUE ("userId", "chapterId"),
        CONSTRAINT "CHK_storytime_user_chapter_progress_percent"
          CHECK ("progressPercent" IS NULL OR ("progressPercent" >= 0 AND "progressPercent" <= 100)),
        CONSTRAINT "FK_storytime_user_chapter_progress_user" FOREIGN KEY ("userId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_user_chapter_progress_chapter" FOREIGN KEY ("chapterId")
          REFERENCES "sto_info_app"."storytime_chapter" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_user_chapter_progress_story" FOREIGN KEY ("storyId")
          REFERENCES "sto_info_app"."storytime_story" ("id") ON DELETE CASCADE
      )
    `,
      // Counting how much of a Story a reader has finished is the hot read.
      `
      CREATE INDEX "IDX_storytime_user_chapter_progress_story"
      ON "sto_info_app"."storytime_user_chapter_progress" ("userId", "storyId", "status")
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
      `DROP TABLE "sto_info_app"."storytime_user_chapter_progress"`,
      `DROP TABLE "sto_info_app"."storytime_user_story_progress"`,
      `DROP TYPE "sto_info_app"."storytime_reader_chapter_status_enum"`,
      `DROP TYPE "sto_info_app"."storytime_reader_story_status_enum"`,
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
