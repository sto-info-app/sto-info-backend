import { MigrationInterface, QueryRunner } from 'typeorm';

export class DatabaseAuditing1741217163381 implements MigrationInterface {
  name = 'DatabaseAuditing1741217163381';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sto_info_app"."_audit" ("id" SERIAL NOT NULL, "entity" character varying NOT NULL, "action" character varying NOT NULL, "entityId" character varying NOT NULL, "oldValue" json, "newValue" json, "userId" character varying, "ipAddress" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0faaf3564b9d0e8a28e83d4bcbe" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "sto_info_app"."_audit_login_attempt" ("id" SERIAL NOT NULL, "email" character varying(255), "ipAddress" character varying, "success" boolean NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6e3a438f7c8f1a3ce530fec0a12" PRIMARY KEY ("id"))`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sto_info_app"."_audit_login_attempt"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."_audit"`);
  }
}
