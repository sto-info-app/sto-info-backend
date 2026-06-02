import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeAccountCreatedDateNullable1767327065257 implements MigrationInterface {
  name = 'MakeAccountCreatedDateNullable1767327065257';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "sto_info_app"."account" ALTER COLUMN "accountCreatedDate" DROP NOT NULL',
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "sto_info_app"."account" ALTER COLUMN "accountCreatedDate" SET NOT NULL',
    );
  }
}
