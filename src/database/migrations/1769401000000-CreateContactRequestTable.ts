import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContactRequestTable1769401000000 implements MigrationInterface {
  name = 'CreateContactRequestTable1769401000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sto_info_app"."contact_request" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "emailMasked" character varying(320) NULL, "topic" character varying(50) NOT NULL, "message" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_contact_request_id" PRIMARY KEY ("id"))`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sto_info_app"."contact_request"`);
  }
}
