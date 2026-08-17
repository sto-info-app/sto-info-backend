import { MigrationInterface, QueryRunner } from 'typeorm';

/** Each searchable table, its weights, and the join carrying its tags. */
const SEARCHABLE = [
  {
    table: 'storytime_story',
    a: ['title'],
    b: ['shortDescription'],
    c: ['description'],
    tagJoin: { table: 'storytime_story_tag', owner: 'storyId' },
  },
  {
    table: 'storytime_chapter',
    a: ['title'],
    b: ['synopsis'],
    c: ['contentSource'],
    tagJoin: null,
  },
  {
    table: 'storytime_character',
    a: ['name'],
    b: ['species', 'rank', 'affiliation'],
    c: ['biographySource'],
    tagJoin: { table: 'storytime_character_tag', owner: 'characterId' },
  },
  {
    table: 'storytime_arc',
    a: ['title'],
    b: ['shortDescription'],
    c: ['description'],
    tagJoin: { table: 'storytime_arc_tag', owner: 'arcId' },
  },
];

export class AddTagsToSearchVectors1789300000000 implements MigrationInterface {
  name = 'AddTagsToSearchVectors1789300000000';

  /**
   * Applies the migration to the database.
   *
   * Adds the tags a Story, Character or Arc carries to its search vector at
   * weight D, and a trigger on each join table so tagging something reindexes
   * it.
   *
   * This is what the vector was built as a trigger for: a generated column may
   * only read its own row, and tags live in a join table. The weight is D
   * deliberately — a tag is how somebody narrows a search, not how they name
   * the thing they are looking for, so a Story tagged "Klingon" must not
   * outrank the Story called Klingon.
   *
   * Chapters carry no tags of their own. A Chapter is part of a Story and is
   * classified by it, so tagging each instalment separately would be asking a
   * writer to do the same work twice.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const entry of SEARCHABLE) {
      if (!entry.tagJoin) {
        continue;
      }

      await this.executeQueries(queryRunner, [
        `
        CREATE OR REPLACE FUNCTION "sto_info_app"."${entry.table}_search_vector"()
        RETURNS trigger AS $$
        BEGIN
          NEW."searchVector" := ${this.buildExpression(entry, 'NEW')};
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql
      `,

        // Reindexes the tagged row whenever its tags change. The UPDATE fires
        // the row's own trigger, which is what rebuilds the vector.
        `
        CREATE FUNCTION "sto_info_app"."${entry.tagJoin.table}_reindex"()
        RETURNS trigger AS $$
        BEGIN
          UPDATE "sto_info_app"."${entry.table}"
          SET "updatedAt" = "updatedAt"
          WHERE "id" = COALESCE(NEW."${entry.tagJoin.owner}", OLD."${entry.tagJoin.owner}");
          RETURN NULL;
        END
        $$ LANGUAGE plpgsql
      `,
        `
        CREATE TRIGGER "TRG_${entry.tagJoin.table}_reindex"
        AFTER INSERT OR DELETE ON "sto_info_app"."${entry.tagJoin.table}"
        FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."${entry.tagJoin.table}_reindex"()
      `,

        `
        UPDATE "sto_info_app"."${entry.table}"
        SET "searchVector" = ${this.buildExpression(entry, null)}
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
    for (const entry of SEARCHABLE) {
      if (!entry.tagJoin) {
        continue;
      }

      await this.executeQueries(queryRunner, [
        `
        DROP TRIGGER "TRG_${entry.tagJoin.table}_reindex"
        ON "sto_info_app"."${entry.tagJoin.table}"
      `,
        `DROP FUNCTION "sto_info_app"."${entry.tagJoin.table}_reindex"()`,
        `
        CREATE OR REPLACE FUNCTION "sto_info_app"."${entry.table}_search_vector"()
        RETURNS trigger AS $$
        BEGIN
          NEW."searchVector" := ${this.buildExpression(entry, 'NEW', false)};
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql
      `,
        `
        UPDATE "sto_info_app"."${entry.table}"
        SET "searchVector" = ${this.buildExpression(entry, null, false)}
      `,
      ]);
    }
  }

  /**
   * Builds the weighted vector expression for a table.
   *
   * @param entry - The table, its weights and its tag join.
   * @param qualifier - The row to read from, or null for a plain column read.
   * @param withTags - Whether to include the tag weight.
   * @returns The SQL expression producing the vector.
   */
  private buildExpression(
    entry: (typeof SEARCHABLE)[number],
    qualifier: string | null,
    withTags = true,
  ): string {
    const weights: [string, string[]][] = [
      ['A', entry.a],
      ['B', entry.b],
      ['C', entry.c],
    ];

    const columns = weights
      .map(([weight, names]) => {
        const text = names
          .map(
            column =>
              `coalesce(${qualifier ? `${qualifier}."${column}"` : `"${column}"`}, '')`,
          )
          .join(" || ' ' || ");

        return `setweight(to_tsvector('english', ${text}), '${weight}')`;
      })
      .join(' || ');

    if (!withTags || !entry.tagJoin) {
      return columns;
    }

    // Qualified by table name in the backfill: the subquery joins two tables
    // that both have an `id`, and Postgres will not guess which is meant.
    const id = qualifier ? `${qualifier}."id"` : `"${entry.table}"."id"`;

    return `${columns} || setweight(to_tsvector('english', coalesce((
      SELECT string_agg("tag"."name", ' ')
      FROM "sto_info_app"."${entry.tagJoin.table}" AS "link"
      JOIN "sto_info_app"."storytime_tag" AS "tag" ON "tag"."id" = "link"."tagId"
      WHERE "link"."${entry.tagJoin.owner}" = ${id}
    ), '')), 'D')`;
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
