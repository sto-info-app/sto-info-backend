import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCharacterNameAndLevel1767517327838 implements MigrationInterface {
  name = 'AddCharacterNameAndLevel1767517327838';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add name as nullable first to avoid failure with existing records
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD "name" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ADD "level" integer`,
    );

    // Backfill name from profilePictureId (which currently stores the name)
    await queryRunner.query(
      `UPDATE "sto_info_app"."character" SET "name" = "profilePictureId"`,
    );

    // Set name to NOT NULL after backfilling
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ALTER COLUMN "name" SET NOT NULL`,
    );

    // Make profilePictureId optional
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ALTER COLUMN "profilePictureId" DROP NOT NULL`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ALTER COLUMN "profilePictureId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP COLUMN "level"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" DROP COLUMN "name"`,
    );
  }
}
