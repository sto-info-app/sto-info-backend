import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveStoringProfileUrl1740935894035 implements MigrationInterface {
  name = 'RemoveStoringProfileUrl1740935894035';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" DROP COLUMN "profilePicture"`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" ADD "profilePicture" character varying`,
    );
  }
}
