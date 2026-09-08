import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeArc1788500000000 implements MigrationInterface {
  name = 'CreateStorytimeArc1788500000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `storytime_arc`, a reading order curated across several Stories, and
   * `storytime_arc_story`, which records what is in one and how it got there.
   *
   * An Arc owns none of the Stories in it, so membership is agreed by both
   * sides: a curator may invite a Story or its owner may ask to join, and only
   * an approved membership counts. That is what stops an Arc from being a way
   * to attach yourself to somebody else's work — in either direction.
   *
   * A membership may name an unpublished Story, so a curator can assemble an
   * Arc before its Stories are released. Public navigation filters those out
   * rather than the schema forbidding them.
   *
   * Arc slugs are unique site-wide rather than per owner, because an Arc is
   * reached by its own address with no Story above it to disambiguate.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_arc_status_enum"
      AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')
    `,

      `
      CREATE TYPE "sto_info_app"."storytime_arc_membership_status_enum"
      AS ENUM ('REQUESTED', 'INVITED', 'APPROVED', 'DECLINED', 'REMOVED', 'WITHDRAWN')
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_arc" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ownerUserId" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "slug" character varying(220) NOT NULL,
        "shortDescription" character varying(500),
        "description" text,
        "descriptionHtml" text,
        "status" "sto_info_app"."storytime_arc_status_enum" NOT NULL DEFAULT 'DRAFT',
        "visibility" "sto_info_app"."storytime_visibility_enum" NOT NULL DEFAULT 'PRIVATE',
        "languageCode" character varying(10) NOT NULL DEFAULT 'en',
        "bannerImageId" character varying(100),
        "bannerImageAlt" character varying(300),
        "profileImageId" character varying(100),
        "profileImageAlt" character varying(300),
        "publishedAt" TIMESTAMP,
        "upVoteCount" integer NOT NULL DEFAULT 0,
        "downVoteCount" integer NOT NULL DEFAULT 0,
        "moderationStatus" "sto_info_app"."storytime_moderation_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "removedAt" TIMESTAMP,
        "removedByUserId" uuid,
        "moderationMessage" character varying(1000),
        "createdByUserId" uuid NOT NULL,
        "updatedByUserId" uuid NOT NULL,
        "deletedByUserId" uuid,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_storytime_arc" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_storytime_arc_vote_counts"
          CHECK ("upVoteCount" >= 0 AND "downVoteCount" >= 0),
        CONSTRAINT "FK_storytime_arc_owner" FOREIGN KEY ("ownerUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_arc_removed_by" FOREIGN KEY ("removedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,

      // Unique site-wide, and partial so soft-deleting an Arc frees its slug.
      `
      CREATE UNIQUE INDEX "UQ_storytime_arc_slug"
      ON "sto_info_app"."storytime_arc" ("slug")
      WHERE "deletedAt" IS NULL
    `,

      `
      CREATE INDEX "IDX_storytime_arc_listing"
      ON "sto_info_app"."storytime_arc"
        ("status", "visibility", "moderationStatus", "publishedAt")
      WHERE "deletedAt" IS NULL
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_arc_story" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "arcId" uuid NOT NULL,
        "storyId" uuid NOT NULL,
        "orderIndex" integer NOT NULL,
        "membershipStatus" "sto_info_app"."storytime_arc_membership_status_enum"
          NOT NULL DEFAULT 'REQUESTED',
        "requestedByUserId" uuid NOT NULL,
        "approvedByUserId" uuid,
        "requestedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "approvedAt" TIMESTAMP,
        "declinedAt" TIMESTAMP,
        "removedAt" TIMESTAMP,
        "introductoryNote" character varying(1000),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_storytime_arc_story" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_storytime_arc_story_order_index" CHECK ("orderIndex" >= 0),
        CONSTRAINT "FK_storytime_arc_story_arc" FOREIGN KEY ("arcId")
          REFERENCES "sto_info_app"."storytime_arc" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_arc_story_story" FOREIGN KEY ("storyId")
          REFERENCES "sto_info_app"."storytime_story" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_arc_story_requested_by" FOREIGN KEY ("requestedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_arc_story_approved_by" FOREIGN KEY ("approvedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,

      // A Story appears in an Arc once, at one position. Both are partial, so
      // a Story that left an Arc may be invited back into the same slot.
      `
      CREATE UNIQUE INDEX "UQ_storytime_arc_story"
      ON "sto_info_app"."storytime_arc_story" ("arcId", "storyId")
      WHERE "deletedAt" IS NULL
    `,
      `
      CREATE UNIQUE INDEX "UQ_storytime_arc_story_order"
      ON "sto_info_app"."storytime_arc_story" ("arcId", "orderIndex")
      WHERE "deletedAt" IS NULL
    `,

      // The index behind public Arc navigation, which only ever wants the
      // approved memberships in reading order.
      `
      CREATE INDEX "IDX_storytime_arc_story_reading"
      ON "sto_info_app"."storytime_arc_story"
        ("arcId", "membershipStatus", "orderIndex")
      WHERE "deletedAt" IS NULL
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
      `DROP TABLE "sto_info_app"."storytime_arc_story"`,
      `DROP TABLE "sto_info_app"."storytime_arc"`,
      `DROP TYPE "sto_info_app"."storytime_arc_membership_status_enum"`,
      `DROP TYPE "sto_info_app"."storytime_arc_status_enum"`,
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
