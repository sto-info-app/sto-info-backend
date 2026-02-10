import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowNullContactEmailMasked1769402000000 implements MigrationInterface {
  name = 'AllowNullContactEmailMasked1769402000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."contact_request" ALTER COLUMN "emailMasked" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."contact_request" ALTER COLUMN "emailMasked" SET NOT NULL`,
    );
  }
}
