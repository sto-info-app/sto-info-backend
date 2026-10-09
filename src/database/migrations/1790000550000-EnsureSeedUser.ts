import { randomUUID } from 'node:crypto';

import * as bcrypt from 'bcrypt';
import { MigrationInterface, QueryRunner } from 'typeorm';

import { isProductionEnvironment } from '../../shared/constants/environment.constants';

/** The seed user's details, as the environment names them. */
interface SeedUser {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  password: string;
}

/** Which environment variable carries each detail. */
const SEED_VARIABLES: Record<keyof SeedUser, string> = {
  email: 'DATASEED_USER_EMAIL',
  username: 'DATASEED_USER_USERNAME',
  firstName: 'DATASEED_USER_FIRSTNAME',
  lastName: 'DATASEED_USER_LASTNAME',
  password: 'DATASEED_USER_PASSWORD',
};

/**
 * Makes the configured local seed user exist before later seeds record them
 * as an owner.
 *
 * Storytime's tag vocabulary is attributed to this user. On a database that
 * has been in use, the application seeder has already created them. On a
 * fresh database the seeder cannot run until migrations finish, and this
 * migration is the one that has their details: `DATASEED_USER_EMAIL`,
 * `DATASEED_USER_USERNAME`, `DATASEED_USER_FIRSTNAME`,
 * `DATASEED_USER_LASTNAME` and `DATASEED_USER_PASSWORD`.
 *
 * Demonstration accounts are a separate migration. They use example.com
 * addresses and this same password. This one is the account named in the
 * local environment, and it is left in place by `down` because that account
 * may already have been in use.
 *
 * An environment that does not set all five variables has no seed user to
 * create, so the migration says so and does nothing. The application seeder
 * is silent in the same case, and a deployment that never had the variables
 * must still be able to run its migrations.
 */
export class EnsureSeedUser1790000550000 implements MigrationInterface {
  name = 'EnsureSeedUser1790000550000';

  /**
   * Inserts the seed user when the environment names one and the database
   * does not already have them.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (isProductionEnvironment(process.env.NODE_ENV)) {
      return;
    }

    const seed = this.readSeedVariables();

    if (!seed) {
      return;
    }

    const { email, username, firstName, lastName, password } = seed;
    const rounds = Number.parseInt(process.env.AUTH_SALT_ROUNDS ?? '10', 10);

    const existing = (await queryRunner.query(
      `
        SELECT "id"
        FROM "sto_info_app"."user"
        WHERE LOWER("email") = LOWER($1)
          AND "deletedAt" IS NULL
        LIMIT 1
      `,
      [email],
    )) as Array<{ id: string }>;

    if (existing[0]) {
      return;
    }

    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, rounds);

    await queryRunner.query(
      `
        INSERT INTO "sto_info_app"."user"
          ("id", "email", "password", "emailVerified", "role", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, true, 'USER', now(), now())
      `,
      [userId, email, passwordHash],
    );

    await queryRunner.query(
      `
        INSERT INTO "sto_info_app"."user_profile"
          ("userId", "username", "firstName", "lastName", "publiclyVisible", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, false, now(), now())
      `,
      [userId, username, firstName, lastName],
    );
  }

  /**
   * Leaves the seed user in place.
   *
   * The same account is created by the application seeder when these
   * variables are set, and on an existing database it was already there
   * before this migration ran. Removing it here would delete that account.
   */
  public async down(): Promise<void> {
    return;
  }

  /**
   * Reads the five seed variables, trimmed and without a surrounding pair of
   * quotes.
   *
   * @returns The seed user's details, or undefined with a notice on the
   * console when any variable is unset or blank.
   */
  private readSeedVariables(): SeedUser | undefined {
    const read = (name: string): string =>
      process.env[name]?.trim().replace(/^['"]|['"]$/g, '') ?? '';

    const seed: SeedUser = {
      email: read('DATASEED_USER_EMAIL'),
      username: read('DATASEED_USER_USERNAME'),
      firstName: read('DATASEED_USER_FIRSTNAME'),
      lastName: read('DATASEED_USER_LASTNAME'),
      password: read('DATASEED_USER_PASSWORD'),
    };

    const missing = (Object.keys(SEED_VARIABLES) as Array<keyof SeedUser>)
      .filter(key => seed[key] === '')
      .map(key => SEED_VARIABLES[key]);

    if (missing.length > 0) {
      console.warn(
        `${this.name}: no seed user to create, ${missing.join(', ')} ${
          missing.length === 1 ? 'is' : 'are'
        } not set.`,
      );

      return undefined;
    }

    return seed;
  }
}
