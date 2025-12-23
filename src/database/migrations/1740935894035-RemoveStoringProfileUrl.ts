import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveStoringProfileUrl1740935894035 implements MigrationInterface {
  name = 'RemoveStoringProfileUrl1740935894035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" DROP COLUMN "profilePicture"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" ADD "profilePicture" character varying`,
    );
  }
}
