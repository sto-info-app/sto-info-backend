import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeStory1787900000000 implements MigrationInterface {
  name = 'CreateStorytimeStory1787900000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `storytime_story` and the shared `storytime_slug_history` table that
   * keeps renamed URLs working.
   *
   * Three states are kept in separate columns and must not be conflated:
   * `status` is where the creator has got to, `visibility` is who may reach the
   * Story once published, and `moderationStatus` is whether an administrator
   * has removed it. That separation is what lets a removed Story be restored to
   * exactly the state its creator left it in, and stops a creator republishing
   * their way out of a moderation decision.
   *
   * Uniqueness is enforced by partial indexes over live rows, matching the rest
   * of the schema: soft-deleting a Story has to free its slug and its position
   * in the owner's collection for reuse.
   *
   * Only the enums this table needs are created here. The remaining Storytime
   * enums arrive with the tables that use them, so a migration never leaves a
   * type behind that nothing references.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_story_status_enum"
      AS ENUM ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_visibility_enum"
      AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE')
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_completion_state_enum"
      AS ENUM ('ONGOING', 'COMPLETED', 'HIATUS', 'CANCELLED')
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_content_rating_enum"
      AS ENUM ('GENERAL', 'MATURE', 'ADULTS_ONLY')
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_moderation_status_enum"
      AS ENUM ('ACTIVE', 'REMOVED')
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_target_type_enum"
      AS ENUM ('STORY', 'CHAPTER', 'CHARACTER', 'ARC', 'MEDIA', 'CREW_CREDIT', 'COMMENT')
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_story" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ownerUserId" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "slug" character varying(220) NOT NULL,
        "shortDescription" character varying(500),
        "description" text,
        "descriptionHtml" text,
        "status" "sto_info_app"."storytime_story_status_enum" NOT NULL DEFAULT 'DRAFT',
        "visibility" "sto_info_app"."storytime_visibility_enum" NOT NULL DEFAULT 'PRIVATE',
        "completionState" "sto_info_app"."storytime_completion_state_enum" NOT NULL DEFAULT 'ONGOING',
        "contentRating" "sto_info_app"."storytime_content_rating_enum" NOT NULL DEFAULT 'GENERAL',
        "languageCode" character varying(10) NOT NULL DEFAULT 'en',
        "ownerOrderIndex" integer NOT NULL,
        "bannerImageId" character varying(100),
        "bannerImageAlt" character varying(300),
        "profileImageId" character varying(100),
        "profileImageAlt" character varying(300),
        "publishedAt" TIMESTAMP,
        "scheduledPublishAt" TIMESTAMP,
        "lastContentUpdateAt" TIMESTAMP,
        "publishedChapterCount" integer NOT NULL DEFAULT 0,
        "upVoteCount" integer NOT NULL DEFAULT 0,
        "downVoteCount" integer NOT NULL DEFAULT 0,
        "contentPolicyAcceptedAt" TIMESTAMP,
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
        CONSTRAINT "PK_storytime_story" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_storytime_story_order_index" CHECK ("ownerOrderIndex" >= 0),
        CONSTRAINT "CHK_storytime_story_chapter_count" CHECK ("publishedChapterCount" >= 0),
        CONSTRAINT "CHK_storytime_story_vote_counts"
          CHECK ("upVoteCount" >= 0 AND "downVoteCount" >= 0),
        CONSTRAINT "FK_storytime_story_owner" FOREIGN KEY ("ownerUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_story_removed_by" FOREIGN KEY ("removedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_storytime_story_restored_by" FOREIGN KEY ("restoredByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,

      // Story slugs are unique across the site, so a Story URL never needs the
      // creator's name to disambiguate it.
      `
      CREATE UNIQUE INDEX "UQ_storytime_story_slug"
      ON "sto_info_app"."storytime_story" ("slug")
      WHERE "deletedAt" IS NULL
    `,
      // One Story per position in an owner's collection. Partial, so deleting a
      // Story frees its position.
      `
      CREATE UNIQUE INDEX "UQ_storytime_story_owner_order"
      ON "sto_info_app"."storytime_story" ("ownerUserId", "ownerOrderIndex")
      WHERE "deletedAt" IS NULL
    `,
      // The index behind every public listing: readable Stories, newest first.
      `
      CREATE INDEX "IDX_storytime_story_public"
      ON "sto_info_app"."storytime_story"
        ("status", "visibility", "moderationStatus", "publishedAt" DESC)
      WHERE "deletedAt" IS NULL
    `,
      // Supports the creator's own dashboard and previous/next navigation.
      `
      CREATE INDEX "IDX_storytime_story_owner"
      ON "sto_info_app"."storytime_story" ("ownerUserId", "ownerOrderIndex")
      WHERE "deletedAt" IS NULL
    `,
      // Discovery filters by rating and language.
      `
      CREATE INDEX "IDX_storytime_story_rating_language"
      ON "sto_info_app"."storytime_story" ("contentRating", "languageCode")
      WHERE "deletedAt" IS NULL
    `,
      // Drives the scheduled-publication job.
      `
      CREATE INDEX "IDX_storytime_story_scheduled"
      ON "sto_info_app"."storytime_story" ("scheduledPublishAt")
      WHERE "status" = 'SCHEDULED' AND "deletedAt" IS NULL
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_slug_history" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "targetType" "sto_info_app"."storytime_target_type_enum" NOT NULL,
        "targetId" uuid NOT NULL,
        "storyId" uuid,
        "slug" character varying(220) NOT NULL,
        "replacedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_slug_history" PRIMARY KEY ("id")
      )
    `,
      // A retired slug is claimed once and never reissued. The COALESCE gives
      // Story and Arc slugs (which have no parent Story) a stable value to be
      // unique against, since Postgres treats NULLs as distinct and would
      // otherwise allow the same global slug to be retired repeatedly.
      `
      CREATE UNIQUE INDEX "UQ_storytime_slug_history"
      ON "sto_info_app"."storytime_slug_history"
        ("targetType", COALESCE("storyId", '00000000-0000-0000-0000-000000000000'::uuid), "slug")
    `,
      // Lookup path for an incoming request on a retired URL.
      `
      CREATE INDEX "IDX_storytime_slug_history_lookup"
      ON "sto_info_app"."storytime_slug_history" ("targetType", "slug")
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
      `DROP TABLE "sto_info_app"."storytime_slug_history"`,
      `DROP TABLE "sto_info_app"."storytime_story"`,
      `DROP TYPE "sto_info_app"."storytime_target_type_enum"`,
      `DROP TYPE "sto_info_app"."storytime_moderation_status_enum"`,
      `DROP TYPE "sto_info_app"."storytime_content_rating_enum"`,
      `DROP TYPE "sto_info_app"."storytime_completion_state_enum"`,
      `DROP TYPE "sto_info_app"."storytime_visibility_enum"`,
      `DROP TYPE "sto_info_app"."storytime_story_status_enum"`,
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
