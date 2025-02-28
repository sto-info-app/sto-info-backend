import { MigrationInterface, QueryRunner } from 'typeorm';

export class UseCloudflareImagesForProfilePics1740712446497
  implements MigrationInterface
{
  name = 'UseCloudflareImagesForProfilePics1740712446497';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" ADD "profilePictureId" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" DROP COLUMN "profilePictureId"`,
    );
  }
}
