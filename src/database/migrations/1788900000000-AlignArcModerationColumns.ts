import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignArcModerationColumns1788900000000 implements MigrationInterface {
  name = 'AlignArcModerationColumns1788900000000';

  /**
   * Applies the migration to the database.
   *
   * Gives an Arc the same moderation columns a Story, Chapter and Character
   * already have: the reason code, and who restored it and when.
   *
   * Arcs were built before there was anything to moderate with, so they ended
   * up with a shorter set. One moderation service now acts on all four kinds
   * of content, and a service that has to remember which of its targets can
   * record a restoration is a service that will eventually get it wrong.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      ALTER TABLE "sto_info_app"."storytime_arc"
      ADD COLUMN "moderationReasonCode" character varying(100),
      ADD COLUMN "restoredAt" TIMESTAMP,
      ADD COLUMN "restoredByUserId" uuid
    `,
      `
      ALTER TABLE "sto_info_app"."storytime_arc"
      ADD CONSTRAINT "FK_storytime_arc_restored_by"
      FOREIGN KEY ("restoredByUserId")
      REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
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
      `
      ALTER TABLE "sto_info_app"."storytime_arc"
      DROP CONSTRAINT "FK_storytime_arc_restored_by"
    `,
      `
      ALTER TABLE "sto_info_app"."storytime_arc"
      DROP COLUMN "moderationReasonCode",
      DROP COLUMN "restoredAt",
      DROP COLUMN "restoredByUserId"
    `,
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
