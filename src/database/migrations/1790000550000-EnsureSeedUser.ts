import { randomUUID } from 'node:crypto';

import * as bcrypt from 'bcrypt';
import { MigrationInterface, QueryRunner } from 'typeorm';

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
 */
export class EnsureSeedUser1790000550000 implements MigrationInterface {
  name = 'EnsureSeedUser1790000550000';

  /**
   * Inserts the seed user when the local environment names one and the
   * database does not already have them.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV?.trim().toLowerCase() === 'prod') {
      return;
    }

    const email = this.required('DATASEED_USER_EMAIL');
    const username = this.required('DATASEED_USER_USERNAME');
    const firstName = this.required('DATASEED_USER_FIRSTNAME');
    const lastName = this.required('DATASEED_USER_LASTNAME');
    const password = this.required('DATASEED_USER_PASSWORD');
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
   * Reads one required seed variable.
   *
   * @param name - The environment variable name.
   * @returns The trimmed value, without a surrounding pair of quotes.
   */
  private required(name: string): string {
    const raw = process.env[name]?.trim().replace(/^['"]|['"]$/g, '');

    if (!raw) {
      throw new Error(`${name} must be set to create the local seed user`);
    }

    return raw;
  }
}
