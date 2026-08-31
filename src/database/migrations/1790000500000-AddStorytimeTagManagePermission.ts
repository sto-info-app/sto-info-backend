import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStorytimeTagManagePermission1790000500000 implements MigrationInterface {
  name = 'AddStorytimeTagManagePermission1790000500000';

  /**
   * Applies the migration to the database.
   *
   * Splits the tag vocabulary out of `storytime.configure` into a permission of
   * its own, and gives it to curators as well as administrators.
   *
   * `storytime.configure` was doing two unrelated jobs: it named the settings
   * an administrator changes — feature flags, per-user limit exemptions — and
   * it happened to be the permission the tag screens were put behind. Keeping
   * both under one code meant a curator could not be given the tag vocabulary
   * without also being described, in the administration UI, as somebody who
   * changes Storytime's settings. After this, `storytime.configure` means only
   * what its name and description say.
   *
   * The seed data is written out in full rather than imported from the
   * application constants, matching the migrations before it: a migration must
   * keep producing the same result forever.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      INSERT INTO "sto_info_app"."permission" ("code", "name", "description", "module")
      VALUES
        ('storytime.tag.manage', 'Manage tags',
         'Add, rename, reorder and remove the shared tag vocabulary creators choose from.', 'STORYTIME')
      ON CONFLICT ("code") DO NOTHING
    `,

      // Curators run Storytime, administrators run Storytime and configure it,
      // so both groups confer the new permission.
      `
      INSERT INTO "sto_info_app"."permission_group_permission" ("permissionGroupId", "permissionId")
      SELECT g."id", p."id"
      FROM "sto_info_app"."permission_group" g
      JOIN "sto_info_app"."permission" p ON p."code" = 'storytime.tag.manage'
      WHERE g."code" IN ('storytime.curator', 'storytime.administrator')
        AND g."deletedAt" IS NULL
      ON CONFLICT ("permissionGroupId", "permissionId") DO NOTHING
    `,

      // The curator group's own description named only two of the three jobs it
      // now confers.
      `
      UPDATE "sto_info_app"."permission_group"
      SET "description" = 'Run Storytime: moderate reported content, curate the Spotlight and keep the tag vocabulary. Granted to Storytime curators.',
          "updatedAt" = now()
      WHERE "code" = 'storytime.curator'
    `,
      `
      UPDATE "sto_info_app"."permission_group"
      SET "description" = 'Everything a curator may do, and configure Storytime as well.',
          "updatedAt" = now()
      WHERE "code" = 'storytime.administrator'
    `,
    ]);
  }

  /**
   * Reverts the migration from the database.
   *
   * Removing the permission takes its group mappings with it by cascade, and
   * the tag screens go back behind `storytime.configure` — which is what the
   * code they run against expects at that point.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      UPDATE "sto_info_app"."permission_group"
      SET "description" = 'Moderate reported content, curate the Spotlight and configure Storytime.',
          "updatedAt" = now()
      WHERE "code" = 'storytime.administrator'
    `,
      `
      UPDATE "sto_info_app"."permission_group"
      SET "description" = 'Moderate reported content and curate the Spotlight. Granted to Storytime curators.',
          "updatedAt" = now()
      WHERE "code" = 'storytime.curator'
    `,
      `
      DELETE FROM "sto_info_app"."permission"
      WHERE "code" = 'storytime.tag.manage'
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
