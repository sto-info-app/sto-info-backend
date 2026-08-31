import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStorytimeCuratorRole1790000400000 implements MigrationInterface {
  name = 'AddStorytimeCuratorRole1790000400000';

  /**
   * Applies the migration to the database.
   *
   * Adds the `STORYTIME_CURATOR` role and the permission group it confers:
   * moderation and Spotlight curation, but not `storytime.configure`, which
   * changes the rules everyone plays by and stays with administrators.
   *
   * The role is a curator's baseline rather than a bundle of per-user
   * overrides, so that promoting somebody is one decision an administrator can
   * take and reverse from the Manage Permissions screen instead of a row
   * written into the database by hand.
   *
   * The enum is widened by replacing the type rather than with
   * `ALTER TYPE ... ADD VALUE`: Postgres refuses to use a value added that way
   * until the transaction adding it has committed, which would leave the seed
   * below unable to name the role it has just created.
   *
   * The seed data is written out in full here rather than imported from the
   * application constants, matching CreateAccessControl1787700000000 — a
   * migration must keep producing the same result forever, and importing a
   * constant that later changes would retroactively change what this migration
   * did.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      // ---------------------------------------------------------------------
      // Widen the role enum. Both columns that use it are converted through
      // text, and the user default is dropped first because a default cannot
      // survive its column's type changing underneath it.
      // ---------------------------------------------------------------------
      `
      ALTER TYPE "sto_info_app"."user_role_enum"
      RENAME TO "user_role_enum_old"
    `,
      `
      CREATE TYPE "sto_info_app"."user_role_enum"
      AS ENUM ('USER', 'ADMIN', 'STORYTIME_CURATOR')
    `,
      `
      ALTER TABLE "sto_info_app"."user"
      ALTER COLUMN "role" DROP DEFAULT
    `,
      `
      ALTER TABLE "sto_info_app"."user"
      ALTER COLUMN "role" TYPE "sto_info_app"."user_role_enum"
      USING "role"::text::"sto_info_app"."user_role_enum"
    `,
      `
      ALTER TABLE "sto_info_app"."user"
      ALTER COLUMN "role" SET DEFAULT 'USER'
    `,
      `
      ALTER TABLE "sto_info_app"."role_permission_group"
      ALTER COLUMN "role" TYPE "sto_info_app"."user_role_enum"
      USING "role"::text::"sto_info_app"."user_role_enum"
    `,
      `DROP TYPE "sto_info_app"."user_role_enum_old"`,

      // ---------------------------------------------------------------------
      // Seed the curator group.
      // ---------------------------------------------------------------------
      `
      INSERT INTO "sto_info_app"."permission_group" ("code", "name", "description", "isSystem")
      VALUES
        ('storytime.curator', 'Storytime Curator',
         'Moderate reported content and curate the Spotlight. Granted to Storytime curators.', true)
    `,
      `
      INSERT INTO "sto_info_app"."permission_group_permission" ("permissionGroupId", "permissionId")
      SELECT g."id", p."id"
      FROM "sto_info_app"."permission_group" g
      JOIN "sto_info_app"."permission" p ON p."code" IN (
        'storytime.moderate',
        'storytime.spotlight.manage'
      )
      WHERE g."code" = 'storytime.curator'
        AND g."deletedAt" IS NULL
    `,

      // ---------------------------------------------------------------------
      // A curator reads and creates like any other member, and additionally
      // moderates and curates.
      // ---------------------------------------------------------------------
      `
      INSERT INTO "sto_info_app"."role_permission_group" ("role", "permissionGroupId")
      SELECT 'STORYTIME_CURATOR'::"sto_info_app"."user_role_enum", g."id"
      FROM "sto_info_app"."permission_group" g
      WHERE g."code" IN ('storytime.reader', 'storytime.creator', 'storytime.curator')
        AND g."deletedAt" IS NULL
    `,
    ]);
  }

  /**
   * Reverts the migration from the database.
   *
   * Curators are returned to USER before the enum narrows again, because the
   * column cannot be converted back to a type that has no name for the value
   * it holds. That demotion is not recoverable by re-running `up`, which is
   * the honest outcome: the narrower enum has nowhere to record who was a
   * curator.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      DELETE FROM "sto_info_app"."role_permission_group"
      WHERE "role" = 'STORYTIME_CURATOR'::"sto_info_app"."user_role_enum"
    `,
      // The group's permission mappings go with it, by cascade.
      `
      DELETE FROM "sto_info_app"."permission_group"
      WHERE "code" = 'storytime.curator'
    `,
      `
      UPDATE "sto_info_app"."user"
      SET "role" = 'USER'::"sto_info_app"."user_role_enum"
      WHERE "role" = 'STORYTIME_CURATOR'::"sto_info_app"."user_role_enum"
    `,

      `
      ALTER TYPE "sto_info_app"."user_role_enum"
      RENAME TO "user_role_enum_old"
    `,
      `
      CREATE TYPE "sto_info_app"."user_role_enum"
      AS ENUM ('USER', 'ADMIN')
    `,
      `
      ALTER TABLE "sto_info_app"."user"
      ALTER COLUMN "role" DROP DEFAULT
    `,
      `
      ALTER TABLE "sto_info_app"."user"
      ALTER COLUMN "role" TYPE "sto_info_app"."user_role_enum"
      USING "role"::text::"sto_info_app"."user_role_enum"
    `,
      `
      ALTER TABLE "sto_info_app"."user"
      ALTER COLUMN "role" SET DEFAULT 'USER'
    `,
      `
      ALTER TABLE "sto_info_app"."role_permission_group"
      ALTER COLUMN "role" TYPE "sto_info_app"."user_role_enum"
      USING "role"::text::"sto_info_app"."user_role_enum"
    `,
      `DROP TYPE "sto_info_app"."user_role_enum_old"`,
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
