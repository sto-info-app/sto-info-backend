import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeCharacter1788200000000 implements MigrationInterface {
  name = 'CreateStorytimeCharacter1788200000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `storytime_character`, the cast of a Story, and
   * `storytime_chapter_character`, which records who appears where.
   *
   * Characters belong to a Story rather than to the site: two creators writing
   * the same canon captain each own their own portrayal. That is why the slug
   * is unique per Story rather than globally, and why deleting a Story takes
   * its cast with it.
   *
   * A Character has no publication state of its own. It is visible exactly
   * when its Story is, because a cast list that could be published separately
   * from the Story it belongs to would only ever be half a cast list.
   *
   * The appearance table carries no `storyId`. That a Chapter and a Character
   * share a Story is a service-layer invariant with its own test: enforcing it
   * here would need a redundant column plus composite foreign keys, buying a
   * rule the service already keeps at the cost of a column that could itself
   * disagree with the two it duplicates.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TABLE "sto_info_app"."storytime_character" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "storyId" uuid NOT NULL,
        "name" character varying(200) NOT NULL,
        "slug" character varying(220) NOT NULL,
        "shortBio" character varying(500),
        "biographySource" text NOT NULL DEFAULT '',
        "biographyHtml" text,
        "biographySchemaVersion" integer NOT NULL DEFAULT 1,
        "portraitImageId" character varying(100),
        "portraitImageAlt" character varying(300),
        "species" character varying(100),
        "faction" character varying(100),
        "rank" character varying(100),
        "occupation" character varying(150),
        "affiliation" character varying(200),
        "shipAssignment" character varying(200),
        "traits" jsonb,
        "isPrimary" boolean NOT NULL DEFAULT false,
        "displayOrder" integer NOT NULL DEFAULT 0,
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
        CONSTRAINT "PK_storytime_character" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_storytime_character_display_order" CHECK ("displayOrder" >= 0),
        CONSTRAINT "FK_storytime_character_story" FOREIGN KEY ("storyId")
          REFERENCES "sto_info_app"."storytime_story" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_character_removed_by" FOREIGN KEY ("removedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_storytime_character_restored_by" FOREIGN KEY ("restoredByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,

      // Unique within the Story, not globally: two Stories may each have a
      // "captain-shran" without either having to disambiguate. Partial, so
      // soft-deleting a Character frees the slug for reuse.
      `
      CREATE UNIQUE INDEX "UQ_storytime_character_slug"
      ON "sto_info_app"."storytime_character" ("storyId", "slug")
      WHERE "deletedAt" IS NULL
    `,

      // The index behind the cast list. Unlike Chapters, display order is not
      // unique: a creator who has never reordered their cast leaves every
      // Character at zero, and refusing that would be pedantry.
      `
      CREATE INDEX "IDX_storytime_character_listing"
      ON "sto_info_app"."storytime_character"
        ("storyId", "moderationStatus", "displayOrder", "name")
      WHERE "deletedAt" IS NULL
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_chapter_character" (
        "chapterId" uuid NOT NULL,
        "characterId" uuid NOT NULL,
        "appearanceOrder" integer NOT NULL DEFAULT 0,
        "appearanceNotes" character varying(500),
        "isPrimary" boolean NOT NULL DEFAULT false,
        "createdByUserId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_chapter_character"
          PRIMARY KEY ("chapterId", "characterId"),
        CONSTRAINT "CHK_storytime_chapter_character_order"
          CHECK ("appearanceOrder" >= 0),
        CONSTRAINT "FK_storytime_chapter_character_chapter" FOREIGN KEY ("chapterId")
          REFERENCES "sto_info_app"."storytime_chapter" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_chapter_character_character" FOREIGN KEY ("characterId")
          REFERENCES "sto_info_app"."storytime_character" ("id") ON DELETE CASCADE
      )
    `,

      // The primary key already covers lookups by Chapter. This is the other
      // direction: every Chapter a given Character appears in, which is what
      // their own page lists.
      `
      CREATE INDEX "IDX_storytime_chapter_character_by_character"
      ON "sto_info_app"."storytime_chapter_character"
        ("characterId", "appearanceOrder")
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
      `DROP TABLE "sto_info_app"."storytime_chapter_character"`,
      `DROP TABLE "sto_info_app"."storytime_character"`,
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
