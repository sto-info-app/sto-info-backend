import { MigrationInterface, QueryRunner } from 'typeorm';

/** The tables that carry a search vector, and what feeds each weight. */
const SEARCHABLE = [
  {
    table: 'storytime_story',
    /** A: what somebody types when they are looking for this exact thing. */
    a: ['title'],
    /** B: the summary they would recognise it by. */
    b: ['shortDescription'],
    /** C: the body, which matches broadly and should rank below both. */
    c: ['description'],
  },
  {
    table: 'storytime_chapter',
    a: ['title'],
    b: ['synopsis'],
    c: ['contentSource'],
  },
  {
    table: 'storytime_character',
    a: ['name'],
    /** What somebody searches a Character by when the name escapes them. */
    b: ['species', 'rank', 'affiliation'],
    c: ['biographySource'],
  },
  {
    table: 'storytime_arc',
    a: ['title'],
    b: ['shortDescription'],
    c: ['description'],
  },
];

export class AddStorytimeSearchVectors1789100000000 implements MigrationInterface {
  name = 'AddStorytimeSearchVectors1789100000000';

  /**
   * Applies the migration to the database.
   *
   * Adds a weighted `tsvector` to each searchable table, a trigger that keeps
   * it current, and a GIN index to search it through.
   *
   * A trigger rather than a generated column: a generated column may only read
   * the row it belongs to, and the vector is meant to grow to include tags,
   * which live in a join table. Building it as a trigger now means adding them
   * later is a new trigger body rather than a new mechanism.
   *
   * Weights follow the plan: A for the title somebody is actually searching
   * for, B for the summary they would recognise it by, C for the body. That
   * ordering is what stops a Story whose text happens to mention "Voyager"
   * ranking above the Story called Voyager.
   *
   * Existing rows are backfilled by the same expression, so search works over
   * everything already written rather than only over what is edited next.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const entry of SEARCHABLE) {
      const expression = this.buildExpression(entry, 'NEW');

      await this.executeQueries(queryRunner, [
        `
        ALTER TABLE "sto_info_app"."${entry.table}"
        ADD COLUMN "searchVector" tsvector
      `,
        `
        CREATE FUNCTION "sto_info_app"."${entry.table}_search_vector"()
        RETURNS trigger AS $$
        BEGIN
          NEW."searchVector" := ${expression};
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql
      `,
        `
        CREATE TRIGGER "TRG_${entry.table}_search_vector"
        BEFORE INSERT OR UPDATE ON "sto_info_app"."${entry.table}"
        FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."${entry.table}_search_vector"()
      `,
        `
        UPDATE "sto_info_app"."${entry.table}"
        SET "searchVector" = ${this.buildExpression(entry, null)}
      `,
        `
        CREATE INDEX "IDX_${entry.table}_search"
        ON "sto_info_app"."${entry.table}" USING GIN ("searchVector")
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
      await this.executeQueries(queryRunner, [
        `DROP INDEX "sto_info_app"."IDX_${entry.table}_search"`,
        `
        DROP TRIGGER "TRG_${entry.table}_search_vector"
        ON "sto_info_app"."${entry.table}"
      `,
        `DROP FUNCTION "sto_info_app"."${entry.table}_search_vector"()`,
        `
        ALTER TABLE "sto_info_app"."${entry.table}"
        DROP COLUMN "searchVector"
      `,
      ]);
    }
  }

  /**
   * Builds the weighted vector expression for a table.
   *
   * @param entry - The table and the columns feeding each weight.
   * @param qualifier - The row to read from, or null for a plain column read.
   * @returns The SQL expression producing the vector.
   */
  private buildExpression(
    entry: (typeof SEARCHABLE)[number],
    qualifier: string | null,
  ): string {
    const weights: [string, string[]][] = [
      ['A', entry.a],
      ['B', entry.b],
      ['C', entry.c],
    ];

    return weights
      .map(([weight, columns]) => {
        const text = columns
          .map(
            column =>
              `coalesce(${qualifier ? `${qualifier}."${column}"` : `"${column}"`}, '')`,
          )
          .join(" || ' ' || ");

        return `setweight(to_tsvector('english', ${text}), '${weight}')`;
      })
      .join(' || ');
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
