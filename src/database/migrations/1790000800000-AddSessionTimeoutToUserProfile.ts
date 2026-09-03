import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionTimeoutToUserProfile1790000800000 implements MigrationInterface {
  name = 'AddSessionTimeoutToUserProfile1790000800000';

  /**
   * Adds the sessionTimeoutMinutes column to the user_profile table.
   *
   * The column is nullable so that existing accounts keep the deployment
   * default until their owner chooses. The check constraint mirrors
   * SESSION_TIMEOUT_OPTIONS_MINUTES; NULL passes it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "sto_info_app"."user_profile" ADD "sessionTimeoutMinutes" integer CONSTRAINT "CHK_user_profile_session_timeout" CHECK ("sessionTimeoutMinutes" IN (60, 240, 480))',
    );
  }

  /**
   * Removes the sessionTimeoutMinutes column from the user_profile table.
   *
   * Dropping the column drops its check constraint with it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "sto_info_app"."user_profile" DROP COLUMN "sessionTimeoutMinutes"',
    );
  }
}
