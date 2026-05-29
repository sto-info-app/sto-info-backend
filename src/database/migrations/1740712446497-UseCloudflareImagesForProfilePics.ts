import { MigrationInterface, QueryRunner } from 'typeorm';

export class UseCloudflareImagesForProfilePics1740712446497 implements MigrationInterface {
  name = 'UseCloudflareImagesForProfilePics1740712446497';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" ADD "profilePictureId" character varying`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" DROP COLUMN "profilePictureId"`,
    );
  }
}
