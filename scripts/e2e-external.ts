/**
 * Support for the external end-to-end project.
 *
 * Registration and password reset store their links on the account before any
 * mail is sent. These commands read that link, age it, and remove only an
 * account this project created. They do not send mail, and they do not read a
 * mailbox. A contact row is read back the same way, because the form can
 * report a delivery failure after the request has already been saved.
 *
 * Profile and character pictures have no remove control. Replacing one deletes
 * the previous Cloudflare image, and the last one is removed here through the
 * same delete the application uses when a picture is replaced.
 */

import { INestApplicationContext } from '@nestjs/common';

import Redis from 'ioredis';
import { DataSource } from 'typeorm';

import { ImageUploadsService } from '../src/shared/utilities/image-uploads.service';

const SCHEMA = process.env.DB_SCHEMA ?? 'sto_info_app';

/** An address this project registered. Fixture actors are not in this set. */
const EXTERNAL_ADDRESS = /^e2eext[a-z0-9]+@example\.com$/;

/**
 * A member whose picture this project may clear.
 *
 * The demonstration member and the fixture actors, all at example.com. A
 * picture is only cleared after a case has uploaded one.
 */
const PICTURE_ADDRESS =
  /^(demo-user-\d+|e2e-[a-z0-9-]+|e2eext[a-z0-9]+)@example\.com$/;

const HANDLE = /^[A-Za-z0-9._-]{1,80}$/;

interface ExternalContext {
  app: INestApplicationContext;
  dataSource: DataSource;
}

/**
 * The verification and reset links stored for one external account.
 *
 * @param dataSource - The application database.
 * @param email - An `e2eext…@example.com` address.
 */
export async function readAuthLink(
  dataSource: DataSource,
  email: string,
): Promise<{
  emailVerified: boolean;
  verificationToken: string | null;
  resetToken: string | null;
}> {
  assertExternalAddress(email);

  const rows = (await dataSource.query(
    `
      SELECT "emailVerified", "emailVerificationToken", "passwordResetToken"
      FROM "${SCHEMA}"."user"
      WHERE lower("email") = lower($1)
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [email],
  )) as Array<{
    emailVerified: boolean;
    emailVerificationToken: string | null;
    passwordResetToken: string | null;
  }>;

  const row = rows[0];

  if (!row) {
    throw new Error(`No external account exists for ${email}.`);
  }

  return {
    emailVerified: row.emailVerified === true,
    verificationToken: row.emailVerificationToken,
    resetToken: row.passwordResetToken,
  };
}

/**
 * Age a stored link so the screen treats it as expired.
 *
 * @param dataSource - The application database.
 * @param email - An `e2eext…@example.com` address.
 * @param kind - `verification` or `reset`.
 */
export async function expireAuthLink(
  dataSource: DataSource,
  email: string,
  kind: string,
): Promise<{ expired: true }> {
  assertExternalAddress(email);

  const tokenColumn =
    kind === 'verification'
      ? 'emailVerificationToken'
      : kind === 'reset'
        ? 'passwordResetToken'
        : '';
  const expiryColumn =
    kind === 'verification'
      ? 'emailVerificationTokenExpiry'
      : kind === 'reset'
        ? 'passwordResetTokenExpiry'
        : '';

  if (!tokenColumn || !expiryColumn) {
    throw new Error('Expire needs verification or reset.');
  }

  const rows = (await dataSource.query(
    `
      SELECT "${tokenColumn}" AS "token"
      FROM "${SCHEMA}"."user"
      WHERE lower("email") = lower($1)
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [email],
  )) as Array<{ token: string | null }>;

  if (!rows[0]?.token) {
    throw new Error(`There is no ${kind} link stored for ${email}.`);
  }

  await dataSource.query(
    `
      UPDATE "${SCHEMA}"."user"
      SET "${expiryColumn}" = now() - interval '2 hours'
      WHERE lower("email") = lower($1)
        AND "deletedAt" IS NULL
    `,
    [email],
  );

  return { expired: true };
}

/**
 * Hard-delete an account this project registered.
 *
 * Soft-delete would keep the email unique, and closing the account through
 * the application sends mail. Missing accounts are ignored. Any other address
 * is refused.
 *
 * @param dataSource - The application database.
 * @param email - An `e2eext…@example.com` address.
 */
export async function discardExternalUser(
  dataSource: DataSource,
  email: string,
): Promise<{ discarded: boolean }> {
  assertExternalAddress(email);

  const rows = (await dataSource.query(
    `
      SELECT "id"
      FROM "${SCHEMA}"."user"
      WHERE lower("email") = lower($1)
      LIMIT 1
    `,
    [email],
  )) as Array<{ id: string }>;
  const userId = rows[0]?.id;

  if (!userId) {
    return { discarded: false };
  }

  await dataSource.query(
    `DELETE FROM "${SCHEMA}"."user_refresh_token" WHERE "userId" = $1`,
    [userId],
  );
  await dataSource.query(
    `DELETE FROM "${SCHEMA}"."user_profile" WHERE "userId" = $1`,
    [userId],
  );
  await dataSource.query(`DELETE FROM "${SCHEMA}"."user" WHERE "id" = $1`, [
    userId,
  ]);

  return { discarded: true };
}

/**
 * The latest contact request saved with this exact message.
 *
 * The message has to start with `E2E external `, so this cannot read a
 * request somebody else sent. The address is stored masked and is not returned.
 *
 * @param dataSource - The application database.
 * @param encodedMessage - The message, base64url, because it contains spaces.
 */
export async function readContactRequest(
  dataSource: DataSource,
  encodedMessage: string,
): Promise<{ name: string; topic: string; message: string }> {
  const message = decodeExternalMessage(encodedMessage);
  const rows = (await dataSource.query(
    `
      SELECT "name", "topic", "message"
      FROM "${SCHEMA}"."contact_request"
      WHERE "message" = $1
      ORDER BY "createdAt" DESC
      LIMIT 1
    `,
    [message],
  )) as Array<{ name: string; topic: string; message: string }>;
  const row = rows[0];

  if (!row) {
    throw new Error('No contact request was stored for that message.');
  }

  return row;
}

/**
 * Remove contact requests this project saved.
 *
 * @param dataSource - The application database.
 * @param encodedMessage - The message, base64url.
 */
export async function discardContactRequest(
  dataSource: DataSource,
  encodedMessage: string,
): Promise<{ discarded: number }> {
  const message = decodeExternalMessage(encodedMessage);
  const rows = (await dataSource.query(
    `
      DELETE FROM "${SCHEMA}"."contact_request"
      WHERE "message" = $1
      RETURNING "id"
    `,
    [message],
  )) as Array<{ id: string }>;

  return { discarded: rows.length };
}

/**
 * Delete the member's personnel picture from Cloudflare and clear the id.
 *
 * @param context - The booted application.
 * @param email - The demonstration member or a fixture actor.
 */
export async function clearPersonnelPicture(
  context: ExternalContext,
  email: string,
): Promise<{ cleared: boolean }> {
  assertPictureAddress(email);
  const userId = await userIdFor(context.dataSource, email);
  const rows = (await context.dataSource.query(
    `
      SELECT "profilePictureId"
      FROM "${SCHEMA}"."user_profile"
      WHERE "userId" = $1
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [userId],
  )) as Array<{ profilePictureId: string | null }>;

  return clearStoredPicture(
    context,
    rows[0]?.profilePictureId ?? null,
    `UPDATE "${SCHEMA}"."user_profile" SET "profilePictureId" = NULL WHERE "userId" = $1`,
    [userId],
  );
}

/**
 * Delete one captain's picture from Cloudflare and clear the id.
 *
 * The captain has to belong to the named member.
 *
 * @param context - The booted application.
 * @param email - The demonstration member or a fixture actor.
 * @param accountHandle - That member's STO account handle.
 * @param characterHandle - The captain on that account.
 */
export async function clearCharacterPicture(
  context: ExternalContext,
  email: string,
  accountHandle: string,
  characterHandle: string,
): Promise<{ cleared: boolean }> {
  assertPictureAddress(email);

  if (!HANDLE.test(accountHandle) || !HANDLE.test(characterHandle)) {
    throw new Error('Account and captain handles must be plain handles.');
  }

  const userId = await userIdFor(context.dataSource, email);
  const rows = (await context.dataSource.query(
    `
      SELECT c."id", c."profilePictureId"
      FROM "${SCHEMA}"."character" c
      JOIN "${SCHEMA}"."account" a ON c."accountId" = a."id"
      WHERE a."userId" = $1
        AND a."handle" = $2
        AND c."handle" = $3
        AND c."deletedAt" IS NULL
        AND a."deletedAt" IS NULL
      LIMIT 1
    `,
    [userId, accountHandle, characterHandle],
  )) as Array<{ id: string; profilePictureId: string | null }>;
  const row = rows[0];

  if (!row) {
    throw new Error(
      `No captain ${characterHandle} on ${accountHandle} for ${email}.`,
    );
  }

  return clearStoredPicture(
    context,
    row.profilePictureId,
    `UPDATE "${SCHEMA}"."character" SET "profilePictureId" = NULL WHERE "id" = $1`,
    [row.id],
  );
}

/**
 * Delete one Cloudflare Images id and clear the column that pointed at it.
 *
 * An id that contains a slash is an older stored path. It is left alone.
 */
async function clearStoredPicture(
  context: ExternalContext,
  imageId: string | null,
  clearSql: string,
  parameters: string[],
): Promise<{ cleared: boolean }> {
  if (!imageId || imageId.includes('/')) {
    return { cleared: false };
  }

  await context.app
    .get(ImageUploadsService)
    .deleteImageFromCloudflareImages(imageId);
  await context.dataSource.query(clearSql, parameters);

  return { cleared: true };
}

async function userIdFor(
  dataSource: DataSource,
  email: string,
): Promise<string> {
  const rows = (await dataSource.query(
    `
      SELECT "id"
      FROM "${SCHEMA}"."user"
      WHERE lower("email") = lower($1)
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [email],
  )) as Array<{ id: string }>;
  const userId = rows[0]?.id;

  if (!userId) {
    throw new Error(`No account exists for ${email}.`);
  }

  return userId;
}

/**
 * Forget the auth rate-limit counters.
 *
 * Sign-in and these cases share one address, and the auth limiter allows 20
 * calls in 15 minutes. Clearing only the `rl:auth:` keys gives the case its
 * own allowance. It does not change the limiter.
 */
export async function clearAuthRateLimit(): Promise<{ cleared: number }> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('REDIS_URL is not set.');
  }

  const redis = new Redis(redisUrl);
  let cleared = 0;

  try {
    let cursor = '0';

    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        'rl:auth:*',
        'COUNT',
        100,
      );
      cursor = next;

      if (keys.length > 0) {
        cleared += keys.length;
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } finally {
    await redis.quit();
  }

  return { cleared };
}

function assertExternalAddress(email: string): void {
  if (!EXTERNAL_ADDRESS.test(email)) {
    throw new Error(
      'This command only accepts an e2eext address at example.com.',
    );
  }
}

function assertPictureAddress(email: string): void {
  if (!PICTURE_ADDRESS.test(email)) {
    throw new Error(
      'This command only clears a picture for a fixture address at example.com.',
    );
  }
}

function decodeExternalMessage(encoded: string): string {
  const message = Buffer.from(encoded, 'base64url').toString('utf8');

  if (!message.startsWith('E2E external ')) {
    throw new Error(
      'This command only reads a contact message from this project.',
    );
  }

  return message;
}
