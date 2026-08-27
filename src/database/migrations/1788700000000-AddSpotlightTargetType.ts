import { MigrationInterface, QueryRunner } from 'typeorm';

/** The values the shared target type enum held before Spotlight existed. */
const PREVIOUS_VALUES = [
  'STORY',
  'CHAPTER',
  'CHARACTER',
  'ARC',
  'MEDIA',
  'CREW_CREDIT',
  'COMMENT',
];

export class AddSpotlightTargetType1788700000000 implements MigrationInterface {
  name = 'AddSpotlightTargetType1788700000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `SPOTLIGHT` to the shared target type enum so a Spotlight entry can
   * retire a slug like everything else that has one. A Spotlight is linked
   * from the site and from wherever the community shares it, so its address
   * outliving a rewritten headline matters for the same reason a Story's does.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      ALTER TYPE "sto_info_app"."storytime_target_type_enum"
      ADD VALUE IF NOT EXISTS 'SPOTLIGHT'
    `,
    ]);
  }

  /**
   * Reverts the migration from the database.
   *
   * Postgres cannot drop a value from an enum, so the type is rebuilt without
   * it and the one column using it is moved across. Any row already naming
   * `SPOTLIGHT` would fail the cast, which is the correct outcome: reverting
   * past the Spotlight tables while Spotlight data exists should stop rather
   * than quietly discard it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const values = PREVIOUS_VALUES.map(value => `'${value}'`).join(', ');

    await this.executeQueries(queryRunner, [
      `
      ALTER TYPE "sto_info_app"."storytime_target_type_enum"
      RENAME TO "storytime_target_type_enum_old"
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_target_type_enum"
      AS ENUM (${values})
    `,
      `
      ALTER TABLE "sto_info_app"."storytime_slug_history"
      ALTER COLUMN "targetType" TYPE "sto_info_app"."storytime_target_type_enum"
      USING "targetType"::text::"sto_info_app"."storytime_target_type_enum"
    `,
      `DROP TYPE "sto_info_app"."storytime_target_type_enum_old"`,
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
