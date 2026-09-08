import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeReaction1789400000000 implements MigrationInterface {
  name = 'CreateStorytimeReaction1789400000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `storytime_reaction`: one row per person per thing they reacted to.
   *
   * The unique index is the whole design. A reader holds at most one reaction
   * on any item, so changing their mind is an update rather than a second vote,
   * and the counts on the Story cannot drift by somebody clicking twice.
   *
   * Counts stay denormalised on the Story, Chapter and Arc because every
   * listing shows a rating and counting rows per card would be a query per
   * card. The rows here are the record; the counts are a cache of them, and
   * both are written in the same transaction.
   *
   * Reactions apply to Stories, Chapters and Arcs — the three things that
   * carry a rating. A Character or a Crew credit is part of somebody's Story
   * rather than a thing to approve of on its own.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_reaction_enum"
      AS ENUM ('THUMBS_UP', 'THUMBS_DOWN')
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_reaction" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "targetType" "sto_info_app"."storytime_target_type_enum" NOT NULL,
        "targetId" uuid NOT NULL,
        "reaction" "sto_info_app"."storytime_reaction_enum" NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_reaction" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_storytime_reaction" UNIQUE ("userId", "targetType", "targetId"),
        CONSTRAINT "FK_storytime_reaction_user" FOREIGN KEY ("userId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE
      )
    `,

      // Drives "how does this reader feel about these Stories", which is what
      // a listing asks when it renders its own state.
      `
      CREATE INDEX "IDX_storytime_reaction_target"
      ON "sto_info_app"."storytime_reaction" ("targetType", "targetId")
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
      `DROP TABLE "sto_info_app"."storytime_reaction"`,
      `DROP TYPE "sto_info_app"."storytime_reaction_enum"`,
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
