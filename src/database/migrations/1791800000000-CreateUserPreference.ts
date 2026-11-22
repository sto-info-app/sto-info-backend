import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `user_preference` and moves the two existing settings into it
 * (FC-006).
 *
 * Preferences have lived on `user_profile` because there were only two of them.
 * This ticket adds nine more and later workstreams add further ones, at which
 * point the profile stops being a description of a person and becomes a
 * settings bag — and `user_profile` is the entity handed to the public member
 * and registry views, so every private preference added to it is one a widened
 * selection could publish by accident.
 *
 * The move is data-preserving and reversible. Rows are copied before the old
 * columns are dropped, and `down()` copies them back before dropping the table,
 * so a rollback loses nothing a user had chosen.
 *
 * Only users who had actually chosen something get a row. A profile with
 * privacy mode off and no timeout is indistinguishable from a profile that
 * never opened the settings page, and inserting a row for every account would
 * write hundreds of rows that say exactly what the defaults already say.
 *
 * The check constraint on `sessionTimeoutMinutes` is carried across verbatim
 * from `CHK_user_profile_session_timeout`: the three permitted windows are a
 * product decision, and the database is where that survives a service being
 * bypassed.
 */
export class CreateUserPreference1791800000000 implements MigrationInterface {
  name = 'CreateUserPreference1791800000000';

  /**
   * Applies the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."presence_visibility_enum" AS ENUM ('EVERYONE', 'FRIENDS', 'FLEETS_AND_ARMADAS')`,
    );

    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."user_preference" (
        "userId" uuid NOT NULL,
        "privacyMode" boolean NOT NULL DEFAULT false,
        "sessionTimeoutMinutes" integer NULL DEFAULT NULL,
        "displayTimezone" character varying(64) NULL DEFAULT NULL,
        "stoExportTimezone" character varying(64) NULL DEFAULT NULL,
        "presenceVisibility" "sto_info_app"."presence_visibility_enum" NOT NULL DEFAULT 'FRIENDS',
        "appearOffline" boolean NOT NULL DEFAULT false,
        "typingIndicatorsEnabled" boolean NOT NULL DEFAULT false,
        "notifyMention" boolean NOT NULL DEFAULT true,
        "notifyReply" boolean NOT NULL DEFAULT true,
        "notifyDirectMessage" boolean NOT NULL DEFAULT true,
        "notifyRosterAssociation" boolean NOT NULL DEFAULT true,
        "notifyEventReminder" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_preference" PRIMARY KEY ("userId"),
        CONSTRAINT "CHK_user_preference_session_timeout" CHECK ("sessionTimeoutMinutes" IN (60, 240, 480)),
        CONSTRAINT "FK_user_preference_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    // Only profiles that actually say something. A row of pure defaults carries
    // no information the entity's own defaults do not already provide.
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."user_preference" ("userId", "privacyMode", "sessionTimeoutMinutes")
      SELECT "userId", "privacyMode", "sessionTimeoutMinutes"
      FROM "sto_info_app"."user_profile"
      WHERE "privacyMode" = true OR "sessionTimeoutMinutes" IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" DROP CONSTRAINT "CHK_user_profile_session_timeout"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" DROP COLUMN "sessionTimeoutMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" DROP COLUMN "privacyMode"`,
    );
  }

  /**
   * Reverts the migration.
   *
   * The columns are restored and repopulated before the table is dropped, so a
   * rollback returns every stored choice rather than resetting it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" ADD "privacyMode" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_profile" ADD "sessionTimeoutMinutes" integer CONSTRAINT "CHK_user_profile_session_timeout" CHECK ("sessionTimeoutMinutes" IN (60, 240, 480))`,
    );

    await queryRunner.query(`
      UPDATE "sto_info_app"."user_profile" AS "profile"
      SET "privacyMode" = "preference"."privacyMode",
          "sessionTimeoutMinutes" = "preference"."sessionTimeoutMinutes"
      FROM "sto_info_app"."user_preference" AS "preference"
      WHERE "preference"."userId" = "profile"."userId"
    `);

    await queryRunner.query(`DROP TABLE "sto_info_app"."user_preference"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."presence_visibility_enum"`,
    );
  }
}
