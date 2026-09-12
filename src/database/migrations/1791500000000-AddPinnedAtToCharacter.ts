import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPinnedAtToCharacter1791500000000 implements MigrationInterface {
  name = 'AddPinnedAtToCharacter1791500000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD "pinnedAt" TIMESTAMP`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP COLUMN "pinnedAt"`,
    );
  }
}
