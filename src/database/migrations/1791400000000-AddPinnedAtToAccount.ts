import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPinnedAtToAccount1791400000000 implements MigrationInterface {
  name = 'AddPinnedAtToAccount1791400000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."account" ADD "pinnedAt" TIMESTAMP`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."account" DROP COLUMN "pinnedAt"`,
    );
  }
}
