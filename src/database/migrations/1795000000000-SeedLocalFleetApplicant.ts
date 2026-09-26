import * as bcrypt from 'bcrypt';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** The seeded applicant, fixed so `down()` removes exactly what `up()` made. */
export const LOCAL_APPLICANT_USER_ID = '6f3d2a1b-8c4e-4f5a-9b6c-7d8e9f0a1b2c';

/** The applicant's STO account on Windows. */
export const LOCAL_APPLICANT_ACCOUNT_ID =
  '7a4e3b2c-9d5f-4a6b-8c7d-8e9f0a1b2c3d';

/** The applicant's Character. */
export const LOCAL_APPLICANT_CHARACTER_ID =
  '8b5f4c3d-0e6a-4b7c-9d8e-9f0a1b2c3d4e';

/**
 * The Character's name and account handle, as the roster fixtures list them.
 *
 * Dax Orlan on `@fixture002` is a Recruit in the Fixture Basic Fleet exports,
 * so a decider looking at this applicant's application sees the roster's
 * evidence rather than an empty panel.
 */
const CHARACTER_NAME = 'Dax Orlan';
const ACCOUNT_HANDLE = 'fixture002';

/**
 * Gives a local database somebody to apply to the Fixture Basic Fleet with
 * (FC-021).
 *
 * Local only, as `SeedLocalFleetFixtures` is: nothing happens unless
 * `NODE_ENV` is `local`. The applicant is a second person, separate from the
 * Fixture Community's Owner, because nobody may decide their own
 * application.
 *
 * Who they are comes from `DATASEED_FLEET_APPLICANT_EMAIL`,
 * `DATASEED_FLEET_APPLICANT_USERNAME` and `DATASEED_FLEET_APPLICANT_PASSWORD`,
 * never from this file, because this repository is public. Without all
 * three the seed does nothing. An existing account at that address is used
 * as it is; otherwise one is made, its address already verified so that it
 * can sign in at once.
 *
 * Either way it gets an STO account on Windows and one Character, Dax Orlan,
 * level 65, a Starfleet (2409) Tactical officer.
 *
 * `down()` removes the Character, the account and — if this seed made it —
 * the person, with everything recruitment recorded about them.
 */
export class SeedLocalFleetApplicant1795000000000 implements MigrationInterface {
  name = 'SeedLocalFleetApplicant1795000000000';

  /**
   * Seeds the applicant, their STO account and their Character.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    const email = process.env.DATASEED_FLEET_APPLICANT_EMAIL?.trim();
    const username = process.env.DATASEED_FLEET_APPLICANT_USERNAME?.trim();
    const password = process.env.DATASEED_FLEET_APPLICANT_PASSWORD;

    if (process.env.NODE_ENV !== 'local' || !email || !username || !password) {
      return;
    }

    const existing: Array<{ id: string }> = await queryRunner.query(
      `SELECT "id" FROM "sto_info_app"."user"
        WHERE lower("email") = lower($1) AND "deletedAt" IS NULL`,
      [email],
    );
    const userId = existing[0]?.id ?? LOCAL_APPLICANT_USER_ID;

    if (existing.length === 0) {
      const hash = await bcrypt.hash(
        password,
        Number(process.env.AUTH_SALT_ROUNDS ?? 10),
      );

      await queryRunner.query(
        `INSERT INTO "sto_info_app"."user" ("id", "email", "password", "emailVerified")
         VALUES ($1, $2, $3, true)`,
        [userId, email, hash],
      );
      await queryRunner.query(
        `INSERT INTO "sto_info_app"."user_profile" ("userId", "username", "firstName", "lastName")
         VALUES ($1, $2, 'Fleet', 'Applicant')`,
        [userId, username],
      );
    }

    await queryRunner.query(
      `INSERT INTO "sto_info_app"."account"
         ("id", "userId", "handle", "handleNormalized", "handleSlug", "platformId")
       SELECT $1, $2, $3::varchar, lower($3::varchar), $3::varchar, "id"
         FROM "sto_info_app"."platform" WHERE "name" = 'Windows'
       ON CONFLICT ("id") DO NOTHING`,
      [LOCAL_APPLICANT_ACCOUNT_ID, userId, ACCOUNT_HANDLE],
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
              (SELECT "id" FROM "sto_info_app"."character_sex" WHERE "name" = 'Male'),
              (SELECT "id" FROM "sto_info_app"."character_class" WHERE "name" = 'Tactical'),
              (SELECT "id" FROM "sto_info_app"."character_species" WHERE "name" = 'Human')
       WHERE EXISTS (SELECT 1 FROM "sto_info_app"."account" WHERE "id" = $2)
       ON CONFLICT ("id") DO NOTHING`,
      [
        LOCAL_APPLICANT_CHARACTER_ID,
        LOCAL_APPLICANT_ACCOUNT_ID,
        CHARACTER_NAME,
        fullHandle,
      ],
    );
  }

  /**
   * Removes the Character, the account and the person this seed made.
   *
   * Recruitment's rows go with the Character and the person, by their own
   * cascades. A person this seed found rather than made is left alone, and
   * anywhere but a local database nothing is removed at all.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV !== 'local') {
      return;
    }

    await queryRunner.query(
      `DELETE FROM "sto_info_app"."character" WHERE "id" = $1`,
      [LOCAL_APPLICANT_CHARACTER_ID],
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."account" WHERE "id" = $1`,
      [LOCAL_APPLICANT_ACCOUNT_ID],
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."user_profile" WHERE "userId" = $1`,
      [LOCAL_APPLICANT_USER_ID],
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."user" WHERE "id" = $1`,
      [LOCAL_APPLICANT_USER_ID],
    );
  }
}
