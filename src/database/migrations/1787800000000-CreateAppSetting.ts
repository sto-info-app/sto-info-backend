import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAppSetting1787800000000 implements MigrationInterface {
  name = 'CreateAppSetting1787800000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `app_setting`, the small set of operational switches an administrator
   * must be able to throw while the site is running. Configuration that only
   * varies between environments stays in environment variables; this table is
   * for the controls needed during an incident, when a redeployment is too slow.
   *
   * Values are stored as text and interpreted by whoever reads them, so adding
   * a setting later needs no schema change.
   *
   * Seeds the Storytime master switch as disabled. Storytime is released as one
   * complete feature, so it must stay off until the whole agreed scope is
   * integrated and production-ready — and an environment that somehow loses the
   * row should keep it hidden rather than expose unfinished work.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TABLE "sto_info_app"."app_setting" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "key" character varying(80) NOT NULL,
        "value" character varying(500) NOT NULL,
        "description" character varying(500),
        "updatedByUserId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_setting" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_app_setting_key" UNIQUE ("key"),
        CONSTRAINT "FK_app_setting_updated_by"
          FOREIGN KEY ("updatedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,
      `
      INSERT INTO "sto_info_app"."app_setting" ("key", "value", "description")
      VALUES (
        'STORYTIME_ENABLED',
        'false',
        'Master switch for STO Storytime. Disables every Storytime route and hides the feature from navigation when false.'
      )
    `,
    ]);
  }

  /**
   * Reverts the migration from the database.
   *
   * The seeded row goes with the table, so no separate delete is required.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `DROP TABLE "sto_info_app"."app_setting"`,
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
