import { MigrationInterface, QueryRunner } from 'typeorm';

/** The applicant's STO account on PlayStation. */
export const LOCAL_APPLICANT_CONSOLE_ACCOUNT_ID =
  '9c6a5d4e-1f7b-4c8d-8e9f-0a1b2c3d4e5f';

/** The applicant's PlayStation Character. */
export const LOCAL_APPLICANT_CONSOLE_CHARACTER_ID =
  'ad7b6e5f-2a8c-4d9e-9f0a-1b2c3d4e5f60';

/** The Character's name and account handle. */
const CHARACTER_NAME = 'Kira Venn';
const ACCOUNT_HANDLE = 'fixtureps002';

/**
 * Gives the local Fleet applicant a Character on PlayStation (FC-021).
 *
 * The Fixture Console Fleet is on PlayStation, where the game writes no
 * roster export, and recruitment there has to be tried by somebody with a
 * Character on that platform. `SeedLocalFleetApplicant` gave the applicant a
 * Windows Character only.
 *
 * Local only, and only for the person `DATASEED_FLEET_APPLICANT_EMAIL` names,
 * who must already exist: that seed makes them. Without either, nothing
 * happens.
 *
 * The Character is Kira Venn on `@fixtureps002`, level 65, a Starfleet (2409)
 * Tactical officer, so the same requirements a Windows Fleet sets can be met.
 * No roster names them, because no console roster exists.
 *
 * `down()` removes the Character and the account.
 */
export class SeedLocalFleetApplicantConsole1795100000000 implements MigrationInterface {
  name = 'SeedLocalFleetApplicantConsole1795100000000';

  /**
   * Seeds the PlayStation account and Character.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    const email = process.env.DATASEED_FLEET_APPLICANT_EMAIL?.trim();

    if (process.env.NODE_ENV !== 'local' || !email) {
      return;
    }

    const existing: Array<{ id: string }> = await queryRunner.query(
      `SELECT "id" FROM "sto_info_app"."user"
        WHERE lower("email") = lower($1) AND "deletedAt" IS NULL`,
      [email],
    );
    const userId = existing[0]?.id;

    if (userId === undefined) {
      return;
    }

    await queryRunner.query(
      `INSERT INTO "sto_info_app"."account"
         ("id", "userId", "handle", "handleNormalized", "handleSlug", "platformId")
       SELECT $1, $2, $3::varchar, lower($3::varchar), $3::varchar, "id"
         FROM "sto_info_app"."platform" WHERE "name" = 'PlayStation'
       ON CONFLICT ("id") DO NOTHING`,
      [LOCAL_APPLICANT_CONSOLE_ACCOUNT_ID, userId, ACCOUNT_HANDLE],
    );

    const fullHandle = `${CHARACTER_NAME}@${ACCOUNT_HANDLE}`;

    await queryRunner.query(
      `INSERT INTO "sto_info_app"."character"
         ("id", "accountId", "handle", "fullHandle", "fullHandleNormalized",
          "fullHandleSlug", "level", "generalFactionId", "factionId", "sexId",
          "classId", "speciesId")
       SELECT $1, $2, $3::varchar, $4::varchar, lower($4::varchar), $4::varchar, 65,
              (SELECT "id" FROM "sto_info_app"."character_general_faction" WHERE "name" = 'Federation'),
              (SELECT "id" FROM "sto_info_app"."character_faction" WHERE "name" = 'Starfleet (2409)'),
              (SELECT "id" FROM "sto_info_app"."character_sex" WHERE "name" = 'Female'),
              (SELECT "id" FROM "sto_info_app"."character_class" WHERE "name" = 'Tactical'),
              (SELECT "id" FROM "sto_info_app"."character_species" WHERE "name" = 'Human')
       WHERE EXISTS (SELECT 1 FROM "sto_info_app"."account" WHERE "id" = $2)
       ON CONFLICT ("id") DO NOTHING`,
      [
        LOCAL_APPLICANT_CONSOLE_CHARACTER_ID,
        LOCAL_APPLICANT_CONSOLE_ACCOUNT_ID,
        CHARACTER_NAME,
        fullHandle,
      ],
    );
  }

  /**
   * Removes the Character and the account.
   *
   * Recruitment's rows about the Character go with it, by their own
   * cascades. Anywhere but a local database nothing is removed.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV !== 'local') {
      return;
    }

    await queryRunner.query(
      `DELETE FROM "sto_info_app"."character" WHERE "id" = $1`,
      [LOCAL_APPLICANT_CONSOLE_CHARACTER_ID],
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."account" WHERE "id" = $1`,
      [LOCAL_APPLICANT_CONSOLE_ACCOUNT_ID],
    );
  }
}
