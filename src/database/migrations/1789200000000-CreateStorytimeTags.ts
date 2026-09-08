import { MigrationInterface, QueryRunner } from 'typeorm';

/** The tables a tag can be attached to, and the column naming each owner. */
const TAGGABLE = [
  { table: 'storytime_story_tag', owner: 'storyId', target: 'storytime_story' },
  { table: 'storytime_arc_tag', owner: 'arcId', target: 'storytime_arc' },
  {
    table: 'storytime_character_tag',
    owner: 'characterId',
    target: 'storytime_character',
  },
];

export class CreateStorytimeTags1789200000000 implements MigrationInterface {
  name = 'CreateStorytimeTags1789200000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `storytime_tag` and the three join tables attaching tags to Stories,
   * Arcs and Characters.
   *
   * Three join tables rather than one polymorphic table: each can carry a real
   * foreign key, so deleting a Story takes its tags with it and nothing has to
   * remember to tidy up. A single table keyed by target type could not.
   *
   * Tags are administrator-managed. `isAdminManaged` is stored anyway, because
   * the plan anticipates creator-supplied secondary tags later, and a column
   * added now costs nothing while a migration over a populated table does not.
   *
   * Slugs are unique across the whole vocabulary rather than within a
   * category, so a tag has one address wherever it is used and a filter link
   * never depends on which shelf it was read from.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_tag_category_enum" AS ENUM (
        'FACTION', 'ERA', 'GENRE', 'TONE', 'THEME', 'SPECIES',
        'CONTENT_WARNING', 'FORMAT', 'CONTINUITY'
      )
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_tag" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "slug" character varying(120) NOT NULL,
        "name" character varying(100) NOT NULL,
        "description" character varying(500),
        "category" "sto_info_app"."storytime_tag_category_enum" NOT NULL,
        "isAdminManaged" boolean NOT NULL DEFAULT true,
        "displayOrder" integer NOT NULL DEFAULT 0,
        "createdByUserId" uuid NOT NULL,
        "updatedByUserId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_storytime_tag" PRIMARY KEY ("id"),
        CONSTRAINT "FK_storytime_tag_created_by" FOREIGN KEY ("createdByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_tag_updated_by" FOREIGN KEY ("updatedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE
      )
    `,

      // Unique among live tags only, so deleting one frees its address.
      `
      CREATE UNIQUE INDEX "UQ_storytime_tag_slug"
      ON "sto_info_app"."storytime_tag" ("slug")
      WHERE "deletedAt" IS NULL
    `,

      // Drives the picker: one category at a time, in the order an
      // administrator arranged it.
      `
      CREATE INDEX "IDX_storytime_tag_category"
      ON "sto_info_app"."storytime_tag" ("category", "displayOrder")
    `,
    ]);

    for (const entry of TAGGABLE) {
      await this.executeQueries(queryRunner, [
        `
        CREATE TABLE "sto_info_app"."${entry.table}" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "${entry.owner}" uuid NOT NULL,
          "tagId" uuid NOT NULL,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_${entry.table}" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_${entry.table}" UNIQUE ("${entry.owner}", "tagId"),
          CONSTRAINT "FK_${entry.table}_owner" FOREIGN KEY ("${entry.owner}")
            REFERENCES "sto_info_app"."${entry.target}" ("id") ON DELETE CASCADE,
          CONSTRAINT "FK_${entry.table}_tag" FOREIGN KEY ("tagId")
            REFERENCES "sto_info_app"."storytime_tag" ("id") ON DELETE CASCADE
        )
      `,
        `
        CREATE INDEX "IDX_${entry.table}_tag"
        ON "sto_info_app"."${entry.table}" ("tagId")
      `,
      ]);
    }
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const entry of TAGGABLE) {
      await this.executeQueries(queryRunner, [
        `DROP TABLE "sto_info_app"."${entry.table}"`,
      ]);
    }

    await this.executeQueries(queryRunner, [
      `DROP TABLE "sto_info_app"."storytime_tag"`,
      `DROP TYPE "sto_info_app"."storytime_tag_category_enum"`,
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
