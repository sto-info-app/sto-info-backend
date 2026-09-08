import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeSpotlight1788800000000 implements MigrationInterface {
  name = 'CreateStorytimeSpotlight1788800000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `storytime_spotlight`, the editorial selections that highlight a
   * Story or an Arc for a period.
   *
   * A Spotlight points at content rather than copying it, so nothing here
   * duplicates a headline or summary the featured Story already has: the
   * editorial words are the Spotlight's own, and everything else is read
   * through the target at the time somebody looks. That is also what lets a
   * removed Story vanish from the Spotlight without the Spotlight being
   * rewritten.
   *
   * The check constraint pins the target to exactly one column matching the
   * entity type, so a row can never claim to feature a Story while carrying an
   * Arc — a rule too easy to break in application code alone once several
   * paths can write here.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_spotlight_entity_type_enum"
      AS ENUM ('STORY', 'ARC')
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_spotlight" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "slug" character varying(220) NOT NULL,
        "entityType" "sto_info_app"."storytime_spotlight_entity_type_enum" NOT NULL,
        "storyId" uuid,
        "arcId" uuid,
        "headline" character varying(200) NOT NULL,
        "summary" text NOT NULL,
        "selectionReason" text,
        "overrideImageId" character varying(100),
        "overrideImageAlt" character varying(300),
        "displayPriority" integer NOT NULL DEFAULT 0,
        "startsAt" TIMESTAMP NOT NULL,
        "endsAt" TIMESTAMP,
        "isPublished" boolean NOT NULL DEFAULT false,
        "createdByUserId" uuid NOT NULL,
        "updatedByUserId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_storytime_spotlight" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_storytime_spotlight_target" CHECK (
          ("entityType" = 'STORY' AND "storyId" IS NOT NULL AND "arcId" IS NULL) OR
          ("entityType" = 'ARC' AND "arcId" IS NOT NULL AND "storyId" IS NULL)
        ),
        CONSTRAINT "CHK_storytime_spotlight_period" CHECK (
          "endsAt" IS NULL OR "endsAt" > "startsAt"
        ),
        CONSTRAINT "FK_storytime_spotlight_story" FOREIGN KEY ("storyId")
          REFERENCES "sto_info_app"."storytime_story" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_spotlight_arc" FOREIGN KEY ("arcId")
          REFERENCES "sto_info_app"."storytime_arc" ("id") ON DELETE CASCADE
      )
    `,

      // Slugs are unique among live entries only, so deleting a Spotlight
      // frees its address for a later one.
      `
      CREATE UNIQUE INDEX "UQ_storytime_spotlight_slug"
      ON "sto_info_app"."storytime_spotlight" ("slug")
      WHERE "deletedAt" IS NULL
    `,

      // Drives the only query readers make: what is showing right now, best
      // first.
      `
      CREATE INDEX "IDX_storytime_spotlight_showing"
      ON "sto_info_app"."storytime_spotlight"
      ("isPublished", "startsAt", "displayPriority")
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
      `DROP TABLE "sto_info_app"."storytime_spotlight"`,
      `DROP TYPE "sto_info_app"."storytime_spotlight_entity_type_enum"`,
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
