import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountHandleCaseInsensitivePerUser1767328845121 implements MigrationInterface {
  name = 'AccountHandleCaseInsensitivePerUser1767328845121';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "sto_info_app"."account" ADD COLUMN IF NOT EXISTS "handleNormalized" character varying(255)',
    );

    await queryRunner.query(
      'UPDATE "sto_info_app"."account" SET "handleNormalized" = lower(trim("handle")) WHERE "handleNormalized" IS NULL',
    );

    await queryRunner.query(
      'ALTER TABLE "sto_info_app"."account" ALTER COLUMN "handleNormalized" SET NOT NULL',
    );

    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UX_account_user_handle_normalized" ON "sto_info_app"."account" ("userId", "handleNormalized") WHERE "deletedAt" IS NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "sto_info_app"."UX_account_user_handle_normalized"',
    );

    await queryRunner.query(
      'ALTER TABLE "sto_info_app"."account" DROP COLUMN IF EXISTS "handleNormalized"',
    );
  }
}
