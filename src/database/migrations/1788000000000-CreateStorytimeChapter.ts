import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeChapter1788000000000 implements MigrationInterface {
  name = 'CreateStorytimeChapter1788000000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `storytime_chapter`, the ordered instalments within a Story.
   *
   * A Chapter may be PUBLISHED while its Story is still a draft. It becomes
   * publicly reachable only once the Story is itself readable, which is what
   * lets a creator stage a whole Story and release it in one action — and is
   * why publication state lives on both and neither is derived from the other.
   *
   * `languageCode` is nullable and means "the same as the Story". Copying the
   * Story's language onto every Chapter would go stale the moment the Story's
   * changed, so only a deliberate departure is recorded.
   *
   * Slug and position are unique per Story rather than globally, enforced by
   * partial indexes so soft-deleting a Chapter frees both for reuse.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_chapter_status_enum"
      AS ENUM ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_chapter" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "storyId" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "slug" character varying(220) NOT NULL,
        "synopsis" character varying(1000),
        "contentSource" text NOT NULL DEFAULT '',
        "contentHtml" text,
        "contentSchemaVersion" integer NOT NULL DEFAULT 1,
        "status" "sto_info_app"."storytime_chapter_status_enum" NOT NULL DEFAULT 'DRAFT',
        "languageCode" character varying(10),
        "orderIndex" integer NOT NULL,
        "coverImageId" character varying(100),
        "coverImageAlt" character varying(300),
        "wordCount" integer NOT NULL DEFAULT 0,
        "estimatedReadingMinutes" integer,
        "publishedAt" TIMESTAMP,
        "scheduledPublishAt" TIMESTAMP,
        "upVoteCount" integer NOT NULL DEFAULT 0,
        "downVoteCount" integer NOT NULL DEFAULT 0,
        "moderationStatus" "sto_info_app"."storytime_moderation_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "removedAt" TIMESTAMP,
        "removedByUserId" uuid,
        "moderationReasonCode" character varying(50),
        "moderationMessage" character varying(1000),
        "restoredAt" TIMESTAMP,
        "restoredByUserId" uuid,
        "createdByUserId" uuid NOT NULL,
        "updatedByUserId" uuid NOT NULL,
        "deletedByUserId" uuid,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_storytime_chapter" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_storytime_chapter_order_index" CHECK ("orderIndex" >= 0),
        CONSTRAINT "CHK_storytime_chapter_word_count" CHECK ("wordCount" >= 0),
        CONSTRAINT "CHK_storytime_chapter_vote_counts"
          CHECK ("upVoteCount" >= 0 AND "downVoteCount" >= 0),
        CONSTRAINT "FK_storytime_chapter_story" FOREIGN KEY ("storyId")
          REFERENCES "sto_info_app"."storytime_story" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_chapter_removed_by" FOREIGN KEY ("removedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_storytime_chapter_restored_by" FOREIGN KEY ("restoredByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,

      // Chapter slugs are unique within their Story, not globally: two Stories
      // may each have a "chapter-one" without either having to disambiguate.
      `
      CREATE UNIQUE INDEX "UQ_storytime_chapter_slug"
      ON "sto_info_app"."storytime_chapter" ("storyId", "slug")
      WHERE "deletedAt" IS NULL
    `,
      `
      CREATE UNIQUE INDEX "UQ_storytime_chapter_order"
      ON "sto_info_app"."storytime_chapter" ("storyId", "orderIndex")
      WHERE "deletedAt" IS NULL
    `,
      // The index behind the Chapter list, previous/next navigation and the
      // reader's progress percentage — the three hottest reads in the feature.
      `
      CREATE INDEX "IDX_storytime_chapter_reading"
      ON "sto_info_app"."storytime_chapter"
        ("storyId", "status", "moderationStatus", "orderIndex")
      WHERE "deletedAt" IS NULL
    `,
      // Drives the scheduled-publication job.
      `
      CREATE INDEX "IDX_storytime_chapter_scheduled"
      ON "sto_info_app"."storytime_chapter" ("scheduledPublishAt")
      WHERE "status" = 'SCHEDULED' AND "deletedAt" IS NULL
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
      `DROP TABLE "sto_info_app"."storytime_chapter"`,
      `DROP TYPE "sto_info_app"."storytime_chapter_status_enum"`,
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
