/**
 * The actors the end-to-end harness signs in as, other than the seeded
 * demonstration member.
 *
 * They are ordinary example.com accounts, hashed with the same seed password
 * the demonstration accounts already use. The demonstration member is not in
 * this list and is never given one of these roles: that account stays a
 * member, because several journeys exist to prove what a member cannot do.
 *
 * News, Storytime content and mail are not created here. Those belong to
 * later phases. This file only makes the people known, and gives three of
 * them one Storytime permission each so a later test can tell a moderator
 * from an administrator.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

import { PERMISSION_CODES } from '../src/access-control/constants/permission-codes.constants';
import { UserRole } from '../src/user/enums/user-role.enum';

const SCHEMA = process.env.DB_SCHEMA ?? 'sto_info_app';

/**
 * The three Storytime permissions that must not travel together on a fixture.
 * A curator role would grant all of them, which would hide a test that only
 * passed because the actor could do something else as well.
 */
const NARROW_PERMISSIONS = [
  PERMISSION_CODES.STORYTIME_MODERATE,
  PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE,
  PERMISSION_CODES.STORYTIME_TAG_MANAGE,
] as const;

interface FixtureActor {
  code: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  /** The one narrow permission this actor holds, if they are not a plain member or an administrator. */
  grant: (typeof NARROW_PERMISSIONS)[number] | null;
}

export const FIXTURE_ACTORS: readonly FixtureActor[] = [
  {
    code: 'B',
    email: 'e2e-member-b@example.com',
    username: 'e2e-member-b',
    firstName: 'E2E',
    lastName: 'Member',
    role: UserRole.USER,
    grant: null,
  },
  {
    code: 'ADM',
    email: 'e2e-admin@example.com',
    username: 'e2e-admin',
    firstName: 'E2E',
    lastName: 'Admin',
    role: UserRole.ADMIN,
    grant: null,
  },
  {
    code: 'MOD',
    email: 'e2e-moderate@example.com',
    username: 'e2e-moderate',
    firstName: 'E2E',
    lastName: 'Moderator',
    role: UserRole.USER,
    grant: PERMISSION_CODES.STORYTIME_MODERATE,
  },
  {
    code: 'SPOT',
    email: 'e2e-spotlight@example.com',
    username: 'e2e-spotlight',
    firstName: 'E2E',
    lastName: 'Spotlight',
    role: UserRole.USER,
    grant: PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE,
  },
  {
    code: 'TAG',
    email: 'e2e-tags@example.com',
    username: 'e2e-tags',
    firstName: 'E2E',
    lastName: 'Tags',
    role: UserRole.USER,
    grant: PERMISSION_CODES.STORYTIME_TAG_MANAGE,
  },
];

export interface KnownActor {
  code: string;
  email: string;
  username: string;
  role: string;
  emailVerified: boolean;
  isAccountDisabled: boolean;
  grants: string[];
}

interface ExistingUser {
  id: string;
  deletedAt: Date | null;
}

/**
 * Creates any missing fixture actor and puts the ones that exist back to the
 * role and permission this file describes.
 *
 * @param dataSource - The backend's own connection.
 * @returns The actors, without passwords.
 */
export async function ensureFixtureActors(
  dataSource: DataSource,
): Promise<KnownActor[]> {
  const password = requiredSecret('DATASEED_USER_PASSWORD');
  const rounds = Number.parseInt(process.env.AUTH_SALT_ROUNDS ?? '10', 10);
  const passwordHash = await bcrypt.hash(password, rounds);
  const ids = new Map<string, string>();

  for (const actor of FIXTURE_ACTORS) {
    ids.set(actor.code, await ensureUser(dataSource, actor, passwordHash));
  }

  const adminId = ids.get('ADM');

  if (!adminId) {
    throw new Error('The administrator fixture was not created.');
  }

  for (const actor of FIXTURE_ACTORS) {
    const userId = ids.get(actor.code);

    if (!userId) {
      throw new Error(`Fixture ${actor.code} was not created.`);
    }

    await replaceNarrowGrant(dataSource, userId, adminId, actor.grant);
  }

  return Promise.all(
    FIXTURE_ACTORS.map(actor => readKnownActor(dataSource, actor)),
  );
}

/**
 * Enables one fixture actor again.
 *
 * A retry does not run the suite setup, so a case that disables an actor has
 * to be able to put that actor back before it tries again. This refuses any
 * address that is not one of the fixtures, including the demonstration member.
 *
 * @param dataSource - The backend's own connection.
 * @param email - The fixture address.
 * @returns The actor after the change.
 */
export async function prepareFixtureActor(
  dataSource: DataSource,
  email: string,
): Promise<KnownActor> {
  const actor = fixtureByEmail(email);

  await dataSource.query(
    `
      UPDATE "${SCHEMA}"."user"
      SET "isAccountDisabled" = false,
          "disabledAt" = NULL,
          "disabledReason" = NULL,
          "updatedAt" = now()
      WHERE lower("email") = lower($1)
        AND "deletedAt" IS NULL
    `,
    [actor.email],
  );

  return readKnownActor(dataSource, actor);
}

/**
 * Reads one fixture actor. The password is not included.
 *
 * @param dataSource - The backend's own connection.
 * @param email - The fixture address.
 * @returns The actor.
 */
export async function readFixtureActor(
  dataSource: DataSource,
  email: string,
): Promise<KnownActor> {
  return readKnownActor(dataSource, fixtureByEmail(email));
}

export interface EnvironmentReport {
  databaseName: string;
  databaseHost: string;
  schema: string;
  nodeEnv: string;
  redisDatabase: number;
  migration: string;
  backendSha: string;
  features: {
    customTracking: boolean;
    storytime: boolean;
  };
  metadata: {
    factions: number;
    species: number;
    classes: number;
  };
  demo: {
    email: string;
    username: string;
    role: string;
    emailVerified: boolean;
    isAccountDisabled: boolean;
    publicAccount: boolean;
    privateAccount: boolean;
    characters: number;
  };
  actors: KnownActor[];
}

/**
 * Checks the database this process is connected to, then makes the fixture
 * actors match their description.
 *
 * @param dataSource - The backend's own connection.
 * @param demoEmail - The seeded demonstration member.
 * @param publicSlug - Their public STO account.
 * @param privateSlug - Their private STO account.
 * @returns A report with no passwords and no connection strings.
 */
export async function inspectEnvironment(
  dataSource: DataSource,
  demoEmail: string,
  publicSlug: string,
  privateSlug: string,
): Promise<EnvironmentReport> {
  const nodeEnv = (process.env.NODE_ENV ?? '').trim().toLowerCase();

  if (nodeEnv === 'prod') {
    throw new Error(
      'Refusing to prepare end-to-end fixtures when NODE_ENV is prod.',
    );
  }

  assertIdentity(demoEmail, publicSlug, privateSlug);

  const databaseName = await scalar(
    dataSource,
    'SELECT current_database() AS value',
  );
  const migration = await scalar(
    dataSource,
    `SELECT "name" AS value FROM "${SCHEMA}"."_migrations" ORDER BY "id" DESC LIMIT 1`,
  );
  const actors = await ensureFixtureActors(dataSource);
  const demo = await inspectDemo(
    dataSource,
    demoEmail,
    publicSlug,
    privateSlug,
  );

  return {
    databaseName,
    databaseHost: process.env.DB_HOST?.trim() || 'unknown',
    schema: SCHEMA,
    nodeEnv,
    redisDatabase: redisDatabase(process.env.REDIS_URL),
    migration,
    backendSha: gitRevision(),
    features: {
      customTracking: await flag(dataSource, 'CUSTOM_TRACKING_ENABLED'),
      storytime: await flag(dataSource, 'STORYTIME_ENABLED'),
    },
    metadata: await metadataCounts(dataSource),
    demo,
    actors,
  };
}

function fixtureByEmail(email: string): FixtureActor {
  const actor = FIXTURE_ACTORS.find(
    candidate => candidate.email.toLowerCase() === email.trim().toLowerCase(),
  );

  if (!actor) {
    throw new Error(
      `${email} is not an end-to-end fixture actor. The demonstration member is left alone by this command.`,
    );
  }

  return actor;
}

async function ensureUser(
  dataSource: DataSource,
  actor: FixtureActor,
  passwordHash: string,
): Promise<string> {
  const existing = (await dataSource.query(
    `
      SELECT "id", "deletedAt"
      FROM "${SCHEMA}"."user"
      WHERE lower("email") = lower($1)
      LIMIT 1
    `,
    [actor.email],
  )) as ExistingUser[];

  if (existing[0]?.deletedAt) {
    throw new Error(
      `${actor.email} is deleted. The end-to-end fixture will not restore a deleted account.`,
    );
  }

  const userId = existing[0]?.id ?? randomUUID();

  if (!existing[0]) {
    await dataSource.query(
      `
        INSERT INTO "${SCHEMA}"."user"
          ("id", "email", "password", "emailVerified", "role", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, true, $4::text::"${SCHEMA}"."user_role_enum", now(), now())
      `,
      [userId, actor.email, passwordHash, actor.role],
    );
  } else {
    await dataSource.query(
      `
        UPDATE "${SCHEMA}"."user"
        SET "password" = $2,
            "emailVerified" = true,
            "role" = $3::text::"${SCHEMA}"."user_role_enum",
            "isAccountDisabled" = false,
            "disabledAt" = NULL,
            "disabledReason" = NULL,
            "updatedAt" = now()
        WHERE "id" = $1
      `,
      [userId, passwordHash, actor.role],
    );
  }

  await ensureProfile(dataSource, userId, actor);

  return userId;
}

async function ensureProfile(
  dataSource: DataSource,
  userId: string,
  actor: FixtureActor,
): Promise<void> {
  const owned = (await dataSource.query(
    `
      SELECT "userId"
      FROM "${SCHEMA}"."user_profile"
      WHERE "userId" = $1
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [userId],
  )) as Array<{ userId: string }>;

  if (owned[0]) {
    return;
  }

  const taken = (await dataSource.query(
    `
      SELECT "userId"
      FROM "${SCHEMA}"."user_profile"
      WHERE lower("username") = lower($1)
        AND "deletedAt" IS NULL
      LIMIT 1
    `,
    [actor.username],
  )) as Array<{ userId: string }>;

  if (taken[0]) {
    throw new Error(
      `Username ${actor.username} already belongs to somebody else.`,
    );
  }

  await dataSource.query(
    `
      INSERT INTO "${SCHEMA}"."user_profile"
        ("userId", "username", "firstName", "lastName", "publiclyVisible", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, false, now(), now())
    `,
    [userId, actor.username, actor.firstName, actor.lastName],
  );
}

async function replaceNarrowGrant(
  dataSource: DataSource,
  userId: string,
  granterId: string,
  grant: FixtureActor['grant'],
): Promise<void> {
  await dataSource.query(
    `
      UPDATE "${SCHEMA}"."user_permission_override"
      SET "deletedAt" = now(),
          "updatedAt" = now()
      WHERE "userId" = $1
        AND "deletedAt" IS NULL
        AND "permissionId" IN (
          SELECT "id"
          FROM "${SCHEMA}"."permission"
          WHERE "code" = ANY($2)
        )
    `,
    [userId, NARROW_PERMISSIONS],
  );

  if (!grant) {
    return;
  }

  const permissions = (await dataSource.query(
    `SELECT "id" FROM "${SCHEMA}"."permission" WHERE "code" = $1 LIMIT 1`,
    [grant],
  )) as Array<{ id: string }>;

  if (!permissions[0]) {
    throw new Error(`Permission ${grant} is not seeded.`);
  }

  await dataSource.query(
    `
      INSERT INTO "${SCHEMA}"."user_permission_override"
        ("id", "userId", "permissionId", "effect", "reason", "grantedByUserId", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'GRANT', 'End-to-end fixture', $4, now(), now())
    `,
    [randomUUID(), userId, permissions[0].id, granterId],
  );
}

async function readKnownActor(
  dataSource: DataSource,
  actor: FixtureActor,
): Promise<KnownActor> {
  const rows = (await dataSource.query(
    `
      SELECT u."role", u."emailVerified", u."isAccountDisabled", p."username"
      FROM "${SCHEMA}"."user" u
      JOIN "${SCHEMA}"."user_profile" p ON p."userId" = u."id"
      WHERE lower(u."email") = lower($1)
        AND u."deletedAt" IS NULL
        AND p."deletedAt" IS NULL
      LIMIT 1
    `,
    [actor.email],
  )) as Array<{
    role: string;
    emailVerified: boolean;
    isAccountDisabled: boolean;
    username: string;
  }>;

  const row = rows[0];

  if (!row) {
    throw new Error(`${actor.email} is not an active account.`);
  }

  if (row.role !== actor.role) {
    throw new Error(
      `${actor.email} has role ${row.role}, expected ${actor.role}.`,
    );
  }

  const grants = (await dataSource.query(
    `
      SELECT permission."code"
      FROM "${SCHEMA}"."user_permission_override" override
      JOIN "${SCHEMA}"."permission" permission
        ON permission."id" = override."permissionId"
      WHERE override."userId" = (
          SELECT "id" FROM "${SCHEMA}"."user" WHERE lower("email") = lower($1)
        )
        AND override."deletedAt" IS NULL
        AND override."effect" = 'GRANT'
        AND permission."code" = ANY($2)
    `,
    [actor.email, NARROW_PERMISSIONS],
  )) as Array<{ code: string }>;
  const codes = grants.map(grant => grant.code).sort();
  const expected = actor.grant ? [actor.grant] : [];

  if (codes.join(',') !== expected.join(',')) {
    throw new Error(
      `${actor.email} holds ${codes.join(', ') || 'no narrow permissions'}, expected ${expected.join(', ') || 'none'}.`,
    );
  }

  return {
    code: actor.code,
    email: actor.email,
    username: row.username,
    role: row.role,
    emailVerified: row.emailVerified,
    isAccountDisabled: row.isAccountDisabled,
    grants: codes,
  };
}

async function inspectDemo(
  dataSource: DataSource,
  email: string,
  publicSlug: string,
  privateSlug: string,
): Promise<EnvironmentReport['demo']> {
  const users = (await dataSource.query(
    `
      SELECT u."role", u."emailVerified", u."isAccountDisabled", p."username"
      FROM "${SCHEMA}"."user" u
      JOIN "${SCHEMA}"."user_profile" p ON p."userId" = u."id"
      WHERE lower(u."email") = lower($1)
        AND u."deletedAt" IS NULL
        AND p."deletedAt" IS NULL
      LIMIT 1
    `,
    [email],
  )) as Array<{
    role: string;
    emailVerified: boolean;
    isAccountDisabled: boolean;
    username: string;
  }>;
  const user = users[0];

  if (!user) {
    throw new Error(`Demonstration member ${email} does not exist.`);
  }

  if (user.role !== UserRole.USER) {
    throw new Error(
      `Demonstration member ${email} has role ${user.role}. That account stays an ordinary member.`,
    );
  }

  const accounts = (await dataSource.query(
    `
      SELECT "handleSlug", "publiclyVisible"
      FROM "${SCHEMA}"."account"
      WHERE "userId" = (
          SELECT "id" FROM "${SCHEMA}"."user" WHERE lower("email") = lower($1)
        )
        AND "deletedAt" IS NULL
    `,
    [email],
  )) as Array<{ handleSlug: string; publiclyVisible: boolean }>;
  const publicAccount = accounts.find(
    account => account.handleSlug === publicSlug,
  );
  const privateAccount = accounts.find(
    account => account.handleSlug === privateSlug,
  );

  if (!publicAccount?.publiclyVisible) {
    throw new Error(`${publicSlug} is not a public account of ${email}.`);
  }

  if (!privateAccount || privateAccount.publiclyVisible) {
    throw new Error(`${privateSlug} is not a private account of ${email}.`);
  }

  const characters = await countWhere(
    dataSource,
    `
      SELECT count(*) AS value
      FROM "${SCHEMA}"."character" captain
      JOIN "${SCHEMA}"."account" account ON account."id" = captain."accountId"
      WHERE account."userId" = (
          SELECT "id" FROM "${SCHEMA}"."user" WHERE lower("email") = lower($1)
        )
        AND captain."deletedAt" IS NULL
        AND account."deletedAt" IS NULL
    `,
    [email],
  );

  if (characters < 2) {
    throw new Error(`${email} needs two characters and has ${characters}.`);
  }

  return {
    email,
    username: user.username,
    role: user.role,
    emailVerified: user.emailVerified,
    isAccountDisabled: user.isAccountDisabled,
    publicAccount: true,
    privateAccount: true,
    characters,
  };
}

function assertIdentity(
  email: string,
  publicSlug: string,
  privateSlug: string,
): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('The demonstration member email is not an email address.');
  }

  if (FIXTURE_ACTORS.some(actor => actor.email === email.toLowerCase())) {
    throw new Error('The demonstration member cannot also be a fixture actor.');
  }

  if (!/^[a-z0-9-]+$/.test(publicSlug) || !/^[a-z0-9-]+$/.test(privateSlug)) {
    throw new Error('Account slugs must be lowercase handles.');
  }

  if (publicSlug === privateSlug) {
    throw new Error('The public and private accounts must be different.');
  }
}

async function metadataCounts(
  dataSource: DataSource,
): Promise<EnvironmentReport['metadata']> {
  const counts = {
    factions: await count(dataSource, 'character_faction'),
    species: await count(dataSource, 'character_species'),
    classes: await count(dataSource, 'character_class'),
  };

  if (counts.factions < 1 || counts.species < 1 || counts.classes < 1) {
    throw new Error(
      'Faction, species or class metadata is missing. The demonstration seed has not finished.',
    );
  }

  return counts;
}

async function flag(dataSource: DataSource, key: string): Promise<boolean> {
  const value = await scalar(
    dataSource,
    `SELECT "value" AS value FROM "${SCHEMA}"."app_setting" WHERE "key" = $1`,
    [key],
  );

  return value === 'true';
}

async function count(dataSource: DataSource, table: string): Promise<number> {
  return countWhere(
    dataSource,
    `SELECT count(*) AS value FROM "${SCHEMA}"."${table}"`,
  );
}

async function countWhere(
  dataSource: DataSource,
  sql: string,
  parameters: unknown[] = [],
): Promise<number> {
  return Number.parseInt(await scalar(dataSource, sql, parameters), 10);
}

async function scalar(
  dataSource: DataSource,
  sql: string,
  parameters: unknown[] = [],
): Promise<string> {
  const rows = (await dataSource.query(sql, parameters)) as Array<{
    value: string | null;
  }>;
  const value = rows[0]?.value;

  if (value === undefined || value === null || value === '') {
    throw new Error('An environment check returned no value.');
  }

  return String(value);
}

function redisDatabase(url: string | undefined): number {
  if (!url?.trim()) {
    throw new Error('REDIS_URL is not set.');
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error('REDIS_URL is not a URL.');
  }

  const segment = parsed.pathname.replace(/^\//, '');

  if (segment === '') {
    return 0;
  }

  const database = Number.parseInt(segment, 10);

  if (!Number.isInteger(database) || String(database) !== segment) {
    throw new Error('REDIS_URL does not name a numeric database.');
  }

  return database;
}

function gitRevision(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

function requiredSecret(name: string): string {
  const value = process.env[name]?.trim().replace(/^['"]|['"]$/g, '');

  if (!value) {
    throw new Error(`${name} must be set to prepare the end-to-end actors.`);
  }

  return value;
}
