import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRole1775300000000 implements MigrationInterface {
  name = 'AddUserRole1775300000000';

  /**
   * Applies the migration to the database.
   *
   * Adds a `role` column to the user table backed by a Postgres enum. When the
   * `ADMIN_EMAIL` environment variable is set, the matching user is promoted to
   * ADMIN so the site owner can manage content without a separate admin portal.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'user_role_enum' AND n.nspname = 'sto_info_app'
        ) THEN
          CREATE TYPE "sto_info_app"."user_role_enum" AS ENUM ('USER', 'ADMIN');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."user"
      ADD COLUMN IF NOT EXISTS "role" "sto_info_app"."user_role_enum"
      NOT NULL DEFAULT 'USER'
    `);

    const adminEmail = process.env.ADMIN_EMAIL?.trim();
    if (adminEmail) {
      await queryRunner.query(
        `UPDATE "sto_info_app"."user" SET "role" = 'ADMIN' WHERE LOWER("email") = LOWER($1)`,
        [adminEmail],
      );
    }
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user" DROP COLUMN "role"`,
    );
    await queryRunner.query(`DROP TYPE "sto_info_app"."user_role_enum"`);
  }
}
