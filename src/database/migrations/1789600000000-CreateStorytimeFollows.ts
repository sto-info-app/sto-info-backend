import { MigrationInterface, QueryRunner } from 'typeorm';

/** Each follow table, and what it points at. */
const FOLLOWS = [
  {
    table: 'storytime_user_creator_follow',
    column: 'creatorUserId',
    target: 'user',
  },
  {
    table: 'storytime_user_story_follow',
    column: 'storyId',
    target: 'storytime_story',
  },
  {
    table: 'storytime_user_arc_follow',
    column: 'arcId',
    target: 'storytime_arc',
  },
];

export class CreateStorytimeFollows1789600000000 implements MigrationInterface {
  name = 'CreateStorytimeFollows1789600000000';

  /**
   * Applies the migration to the database.
   *
   * Adds the three follow tables and the activity feed they fill.
   *
   * A table per kind of follow rather than one polymorphic table, for the same
   * reason tags have three: each carries a real foreign key, so deleting a
   * Story takes its followers with it. Each enforces one active follow per
   * person per thing, which is what makes following idempotent — pressing the
   * button twice is not two follows.
   *
   * `storytime_activity_feed_item` records the event and the identifiers
   * involved and copies no content. A feed is read long after it is written,
   * by which time a Story may have been unpublished, made private or removed;
   * storing a title would mean serving one that is no longer true. Visibility
   * is rechecked when the feed is read.
   *
   * `storytime_user_activity_feed_state` holds a watermark per reader rather
   * than a row per item per reader. The unread badge only needs to know what
   * they have seen up to, and a per-item table would grow with readers times
   * events for the sake of a number.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const follow of FOLLOWS) {
      await this.executeQueries(queryRunner, [
        `
        CREATE TABLE "sto_info_app"."${follow.table}" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "userId" uuid NOT NULL,
          "${follow.column}" uuid NOT NULL,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_${follow.table}" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_${follow.table}" UNIQUE ("userId", "${follow.column}"),
          CONSTRAINT "FK_${follow.table}_user" FOREIGN KEY ("userId")
            REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
          CONSTRAINT "FK_${follow.table}_target" FOREIGN KEY ("${follow.column}")
            REFERENCES "sto_info_app"."${follow.target}" ("id") ON DELETE CASCADE
        )
      `,
        `
        CREATE INDEX "IDX_${follow.table}_target"
        ON "sto_info_app"."${follow.table}" ("${follow.column}")
      `,
      ]);
    }

    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_activity_type_enum" AS ENUM (
        'STORY_PUBLISHED', 'CHAPTER_PUBLISHED', 'STORY_UPDATED',
        'STORY_STATUS_CHANGED', 'ARC_UPDATED', 'ARC_STORY_ADDED',
        'ARC_STORY_REMOVED', 'SPOTLIGHT_SELECTED'
      )
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_activity_feed_item" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "activityType" "sto_info_app"."storytime_activity_type_enum" NOT NULL,
        "actorUserId" uuid NOT NULL,
        "storyId" uuid,
        "chapterId" uuid,
        "arcId" uuid,
        "occurredAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_activity_feed_item" PRIMARY KEY ("id"),
        CONSTRAINT "FK_storytime_activity_actor" FOREIGN KEY ("actorUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_activity_story" FOREIGN KEY ("storyId")
          REFERENCES "sto_info_app"."storytime_story" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_activity_chapter" FOREIGN KEY ("chapterId")
          REFERENCES "sto_info_app"."storytime_chapter" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_activity_arc" FOREIGN KEY ("arcId")
          REFERENCES "sto_info_app"."storytime_arc" ("id") ON DELETE CASCADE
      )
    `,

      // Drives the feed itself: what happened recently, newest first.
      `
      CREATE INDEX "IDX_storytime_activity_when"
      ON "sto_info_app"."storytime_activity_feed_item" ("occurredAt" DESC)
    `,

      // Drives "what has this creator done", which is how a follow becomes a
      // feed.
      `
      CREATE INDEX "IDX_storytime_activity_actor"
      ON "sto_info_app"."storytime_activity_feed_item" ("actorUserId", "occurredAt")
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_user_activity_feed_state" (
        "userId" uuid NOT NULL,
        "lastReadAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_user_activity_feed_state" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_storytime_feed_state_user" FOREIGN KEY ("userId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE
      )
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
      `DROP TABLE "sto_info_app"."storytime_user_activity_feed_state"`,
      `DROP TABLE "sto_info_app"."storytime_activity_feed_item"`,
      `DROP TYPE "sto_info_app"."storytime_activity_type_enum"`,
    ]);

    for (const follow of FOLLOWS) {
      await this.executeQueries(queryRunner, [
        `DROP TABLE "sto_info_app"."${follow.table}"`,
      ]);
    }
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
