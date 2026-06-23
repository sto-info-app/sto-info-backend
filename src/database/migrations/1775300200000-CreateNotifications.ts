import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotifications1775300200000 implements MigrationInterface {
  name = 'CreateNotifications1775300200000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."notification_severity_enum" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."notification_target_enum" AS ENUM ('BROADCAST', 'USER')`,
    );

    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."banner" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "severity" "sto_info_app"."notification_severity_enum" NOT NULL DEFAULT 'INFO',
        "title" character varying(120),
        "message" character varying(500) NOT NULL,
        "linkUrl" character varying(2048),
        "linkLabel" character varying(80),
        "dismissible" boolean NOT NULL DEFAULT true,
        "active" boolean NOT NULL DEFAULT true,
        "startsAt" TIMESTAMP,
        "endsAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_banner" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IX_banner_active" ON "sto_info_app"."banner" ("active")`,
    );

    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."notification" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "target" "sto_info_app"."notification_target_enum" NOT NULL DEFAULT 'BROADCAST',
        "userId" uuid,
        "severity" "sto_info_app"."notification_severity_enum" NOT NULL DEFAULT 'INFO',
        "title" character varying(160) NOT NULL,
        "body" character varying(2000) NOT NULL,
        "linkUrl" character varying(2048),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_notification" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IX_notification_target_user" ON "sto_info_app"."notification" ("target", "userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."notification_read" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "notificationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "readAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_read" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_notification_read_notification_user" ON "sto_info_app"."notification_read" ("notificationId", "userId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."notification_read"
      ADD CONSTRAINT "FK_notification_read_notification"
      FOREIGN KEY ("notificationId")
      REFERENCES "sto_info_app"."notification"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."notification_read" DROP CONSTRAINT "FK_notification_read_notification"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_notification_read_notification_user"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."notification_read"`);
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IX_notification_target_user"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."notification"`);
    await queryRunner.query(`DROP INDEX "sto_info_app"."IX_banner_active"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."banner"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."notification_target_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."notification_severity_enum"`,
    );
  }
}
