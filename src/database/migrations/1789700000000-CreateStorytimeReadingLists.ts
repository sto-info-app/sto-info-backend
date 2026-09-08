import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeReadingLists1789700000000 implements MigrationInterface {
  name = 'CreateStorytimeReadingLists1789700000000';

  /**
   * Applies the migration to the database.
   *
   * Adds reading lists and the things on them.
   *
   * A list is either private or public, and a public one is addressed by a slug
   * unique to its owner rather than site-wide: two people may both keep a list
   * called "Klingon favourites", and neither should have to rename theirs
   * because the other got there first. The uniqueness is partial on `deletedAt`
   * so that deleting a list frees its address.
   *
   * An item points at either a Story or an Arc and never both, enforced by a
   * check constraint rather than convention, and a list may hold each thing
   * once. Position is explicit: a reading list is an order, and the order is
   * the point of it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TABLE "sto_info_app"."storytime_reading_list" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ownerUserId" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "slug" character varying(140) NOT NULL,
        "description" character varying(1000),
        "isPublic" boolean NOT NULL DEFAULT false,
        "itemCount" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_storytime_reading_list" PRIMARY KEY ("id"),
        CONSTRAINT "FK_storytime_reading_list_owner" FOREIGN KEY ("ownerUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_storytime_reading_list_name" CHECK (length(trim("name")) > 0)
      )
    `,

      // Unique to the owner rather than site-wide: two people may both keep a
      // list of the same name, and neither should have to rename theirs.
      `
      CREATE UNIQUE INDEX "UQ_storytime_reading_list_slug"
      ON "sto_info_app"."storytime_reading_list" ("ownerUserId", "slug")
      WHERE "deletedAt" IS NULL
    `,

      // Drives "my lists", which is the only way most people reach one.
      `
      CREATE INDEX "IDX_storytime_reading_list_owner"
      ON "sto_info_app"."storytime_reading_list" ("ownerUserId", "updatedAt" DESC)
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_reading_list_item" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "readingListId" uuid NOT NULL,
        "storyId" uuid,
        "arcId" uuid,
        "note" character varying(500),
        "orderIndex" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_reading_list_item" PRIMARY KEY ("id"),
        CONSTRAINT "FK_storytime_reading_list_item_list" FOREIGN KEY ("readingListId")
          REFERENCES "sto_info_app"."storytime_reading_list" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_reading_list_item_story" FOREIGN KEY ("storyId")
          REFERENCES "sto_info_app"."storytime_story" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_reading_list_item_arc" FOREIGN KEY ("arcId")
          REFERENCES "sto_info_app"."storytime_arc" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_storytime_reading_list_item_target" CHECK (
          ("storyId" IS NOT NULL AND "arcId" IS NULL)
          OR ("storyId" IS NULL AND "arcId" IS NOT NULL)
        )
      )
    `,

      // A list holds each thing once. Adding what is already on a list is the
      // list, not an error, and the constraint is what lets the service say so.
      `
      CREATE UNIQUE INDEX "UQ_storytime_reading_list_item_story"
      ON "sto_info_app"."storytime_reading_list_item" ("readingListId", "storyId")
      WHERE "storyId" IS NOT NULL
    `,

      `
      CREATE UNIQUE INDEX "UQ_storytime_reading_list_item_arc"
      ON "sto_info_app"."storytime_reading_list_item" ("readingListId", "arcId")
      WHERE "arcId" IS NOT NULL
    `,

      // Drives reading a list in its own order.
      `
      CREATE INDEX "IDX_storytime_reading_list_item_order"
      ON "sto_info_app"."storytime_reading_list_item" ("readingListId", "orderIndex")
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
      `DROP TABLE "sto_info_app"."storytime_reading_list_item"`,
      `DROP TABLE "sto_info_app"."storytime_reading_list"`,
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
