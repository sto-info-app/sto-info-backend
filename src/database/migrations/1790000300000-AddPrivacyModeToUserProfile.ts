import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrivacyModeToUserProfile1790000300000 implements MigrationInterface {
  name = 'AddPrivacyModeToUserProfile1790000300000';

  /**
   * Adds the privacyMode column to the user_profile table.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "sto_info_app"."user_profile" ADD "privacyMode" boolean NOT NULL DEFAULT false',
    );
  }

  /**
   * Removes the privacyMode column from the user_profile table.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "sto_info_app"."user_profile" DROP COLUMN "privacyMode"',
    );
  }
}
