import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import * as bcrypt from 'bcrypt';

import {
  AUDITED_BY_IDENTIFIERS_ONLY,
  POLICY_NOTICE_ID,
} from '../../src/database/migrations/1796500000000-AddPrivacyErasure';
import { PUBLISHED_IMAGE_GUARD_SQLSTATE } from '../../src/database/migrations/1797300000000-GuardPublishedImageReferences';
import { FEATURE_SWITCH_ACTIONS_DOWN_REFUSAL } from '../../src/database/migrations/1797700000000-RecordFeatureSwitchChanges';
import { CHARACTER_PICTURE_SHAPE } from '../../src/database/migrations/1797800000000-ClearCharacterNamesFromPictures';
import { PLATFORM_RENAME_GUARD_SQLSTATE } from '../../src/database/migrations/1797900000000-GuardPlatformRenames';
import { failureOf, Rehearsal } from '../operations-rehearsal/rehearse';
import {
  Api,
  BUCKETS,
  createBuckets,
  Database,
  docker,
  generated,
  MINIO_USER,
  runNode,
  secondsSince,
  seedSecret,
  sqlState,
  waitFor,
} from '../operations-rehearsal/stack';

/**
 * The Fleet Community v1 release, rehearsed from production as it is (FC-045).
 *
 * Steve's decisions of 6 October 2026: a synthetic, throwaway rehearsal. The
 * production release (`origin/production`) is built and its own migrations
 * make a database exactly as production's schema is, filled by its own demo
 * seed and by `sql/production-seed.sql` with rows of every kind the release's
 * migrations read or change. Then:
 *
 * - **R1** the preflight (`scripts/release-preflight/preflight.sql`) passes on
 *   it, as it must on production before the release;
 * - **R2** this release's migrations run, timed;
 * - **R3** every row and column that existed before is compared with the
 *   copy taken before migrating, save only the changes the release makes on
 *   purpose, each of which is checked for itself;
 * - **R4** this release boots, Fleet Community is off, and a site admin turns
 *   it on and off again from the feature switches, with existing news and
 *   members untouched throughout;
 * - **R5** the ways back are tried: the newest migrations reverted where they
 *   may be and refused where history would be lost, and the production
 *   release booted on the migrated database;
 * - **R6** each row the preflight looks for is planted in a copy of the
 *   pre-migration database, and shown both to be found by the preflight and
 *   to fail the migrations — which then change nothing.
 *
 * Every container is the run's own; no real data is used.
 */

/** Production's last migration, which this release starts from. */
const PRODUCTION_HEAD = 1791500000000;

/** Production's migrations before `SeedStorytimeTags`, which needs a site admin. */
const BEFORE_STORYTIME_TAGS =
  'src/database/migrations/{17[0-8]*,1790000[0-5]*}.ts';

/** The secret key names the production release reads, beside the new ones. */
const PRODUCTION_SECRET_KEYS = [
  'cloudflareImagesApiKey',
  'cloudflareR2AccessKey',
  'cloudflareR2Secret',
  'cloudmersiveApiKey',
] as const;

/** The databases this rehearsal makes beside the main one. */
const BEFORE = 'release_before';
const REVERT = 'release_revert';

/** What a site admin gives as their reason. */
const REASON = 'Release rehearsal (FC-045): checking the feature switch';

/** Rows the release adds to tables production already has, on purpose. */
const ADDED_ROWS: Record<string, string> = {
  notification: `"id" <> '${POLICY_NOTICE_ID}'`,
  app_setting: `"key" NOT IN ('FLEET_COMMUNITIES_ENABLED', 'FILE_PUBLICATION_PAUSED')`,
};

/** Tables that are bookkeeping rather than anybody's history. */
const NOT_HISTORY = new Set(['_migrations']);

/**
 * What a column held before the release, as the release means it to read
 * after: the changes it makes on purpose, each checked on its own in R3.
 */
const INTENDED: Record<string, string> = {
  // ADR-0013: a day somebody typed is a date.
  'account.accountCreatedDate': `"accountCreatedDate"::date`,
  'character.createdDate': `"createdDate"::date`,
  // 1797800000000: a name is not a picture.
  'character.profilePictureId': `CASE WHEN POSITION('/' IN "profilePictureId") = 0 AND "profilePictureId" !~* '${CHARACTER_PICTURE_SHAPE}' THEN NULL ELSE "profilePictureId" END`,
  // FC-038: these audit snapshots keep their identifiers only.
  '_audit.oldValue': stripped('oldValue'),
  '_audit.newValue': stripped('newValue'),
};

/**
 * An audit snapshot as FC-038's migration leaves it.
 *
 * @param column - The snapshot column.
 * @returns The expression.
 */
function stripped(column: string): string {
  const entities = AUDITED_BY_IDENTIFIERS_ONLY.map(
    entity => `'${entity}'`,
  ).join(', ');

  return `CASE WHEN "entity" IN (${entities}) THEN (SELECT json_object_agg(key, value) FROM json_each("${column}") WHERE key = 'id' OR key LIKE '%Id') ELSE "${column}" END`;
}

/** The production release's build and checkout, from `run-rehearsal.sh`. */
function production(r: Rehearsal): { build: string; checkout: string } {
  if (r.config.oldBackendMain === null) {
    throw new Error(
      `the production release was not built (${r.config.oldBackendSkipped}); this rehearsal needs it`,
    );
  }

  const build = dirname(dirname(r.config.oldBackendMain));

  return { build, checkout: dirname(build) };
}

/**
 * Runs the production release's own migrations as `start:render` runs them
 * on Render: its `migration:run`, through ts-node, on its own TypeORM
 * configuration and its own migration files. (Its build does not compile
 * the configuration.)
 *
 * @param r - The rehearsal.
 * @param migrations - Which, as a glob, when not all of them.
 * @returns Its exit code and output.
 */
async function productionMigrations(
  r: Rehearsal,
  migrations?: string,
): Promise<{ code: number; output: string }> {
  const { build, checkout } = production(r);
  const env = r.backendEnvironment(build, checkout);

  env.NODE_PATH = join(checkout, 'node_modules');

  if (migrations !== undefined) {
    env.TYPEORM_MIGRATIONS = migrations;
  }

  const result = await runNode(
    join(checkout, 'node_modules', 'ts-node', 'dist', 'bin.js'),
    [
      '-r',
      'tsconfig-paths/register',
      join(checkout, 'node_modules', 'typeorm', 'cli.js'),
      'migration:run',
      '-d',
      join(checkout, 'config', 'typeorm.datasource.ts'),
    ],
    checkout,
    env,
  );

  writeFileSync(
    join(r.logs, `production-migrations-${Date.now()}.log`),
    result.output,
  );

  return result;
}

/**
 * Runs a SQL file with psql inside the PostgreSQL container.
 *
 * @param r - The rehearsal.
 * @param file - The file, on this machine.
 * @param database - Which database.
 * @param variables - psql variables.
 * @returns Its exit code and output.
 */
async function psqlFile(
  r: Rehearsal,
  file: string,
  database: string,
  variables: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  const target = `/tmp/${file.split(/[\\/]/).pop()}`;
  const flags = Object.entries(variables)
    .map(([name, value]) => `-v ${name}=${value}`)
    .join(' ');

  await docker('cp', file, `${r.containers.name('pg')}:${target}`);

  try {
    const output = await r.containers.exec(
      'pg',
      `psql -U postgres -d ${database} -v ON_ERROR_STOP=1 -q ${flags} -f ${target} 2>&1`,
    );

    return { code: 0, output };
  } catch (error: unknown) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };

    return {
      code: typeof failed.code === 'number' ? failed.code : 1,
      output: `${failed.stdout ?? ''}${failed.stderr ?? ''}`,
    };
  }
}

/**
 * Makes a database a copy of another. Nothing may be connected to the
 * original while it is copied.
 *
 * @param r - The rehearsal.
 * @param name - The copy.
 * @param from - The original.
 */
async function copyDatabase(
  r: Rehearsal,
  name: string,
  from: string,
): Promise<void> {
  await r.containers.exec(
    'pg',
    `dropdb -U postgres --if-exists ${name} && createdb -U postgres -T ${from} ${name}`,
  );
}

/**
 * The base tables of the release's schema in a database, with their columns
 * and types.
 *
 * @param db - The database.
 * @returns Each table's columns, by name, with their types.
 */
async function columnsOf(
  db: Database,
): Promise<Map<string, Map<string, string>>> {
  const rows = await db.query<{ table: string; column: string; type: string }>(
    `SELECT c."table_name" AS "table", c."column_name" AS "column", c."data_type" AS "type"
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t."table_schema" = c."table_schema" AND t."table_name" = c."table_name"
      WHERE c."table_schema" = 'sto_info_app' AND t."table_type" = 'BASE TABLE'
      ORDER BY c."table_name", c."ordinal_position"`,
  );
  const tables = new Map<string, Map<string, string>>();

  for (const row of rows) {
    const columns = tables.get(row.table) ?? new Map<string, string>();

    columns.set(row.column, row.type);
    tables.set(row.table, columns);
  }

  return tables;
}

/**
 * A fingerprint of a table's rows: every row's values, in a fixed order,
 * hashed, with how many there are.
 *
 * @param db - The database.
 * @param table - The table.
 * @param expressions - One expression a column.
 * @param where - Which rows, when not all.
 * @returns The row count and the hash.
 */
async function fingerprint(
  db: Database,
  table: string,
  expressions: string[],
  where = 'true',
): Promise<{ rows: number; hash: string }> {
  const row = expressions
    .map(expression => `quote_nullable((${expression})::text)`)
    .join(` || ',' || `);
  const [answer] = await db.query<{ rows: number; hash: string | null }>(
    `SELECT count(*)::int AS "rows", md5(string_agg(r, chr(10) ORDER BY r)) AS "hash"
       FROM (SELECT ${row} AS r FROM "sto_info_app"."${table}" WHERE ${where}) AS rows`,
  );

  return { rows: answer.rows, hash: answer.hash ?? '' };
}

/**
 * R1: production's schema, made by production's own migrations and filled
 * with production-shaped rows; the preflight passes on it.
 *
 * @param r - The rehearsal.
 */
async function production1(r: Rehearsal): Promise<void> {
  const name = 'R1 Production as it is';
  const started = Date.now();

  await r.containers.start('pg', 'redis', 'minio', 'aws');
  await waitFor(
    'PostgreSQL',
    () => r.db.value<number>('SELECT 1 AS "value"'),
    120_000,
  );
  // PostgreSQL restarts once during its first initialisation; ask again.
  await waitFor(
    'PostgreSQL, settled',
    () => r.db.value<number>('SELECT 1 AS "value"'),
    60_000,
  );
  await waitFor(
    'the local Secrets Manager',
    async () =>
      (
        await fetch(
          `http://127.0.0.1:${r.config.ports.aws}/_localstack/health`,
        ).catch(() => null)
      )?.ok ?? false,
    120_000,
  );

  // Both releases' key names: production reads the old ones until it is
  // replaced, as on the day.
  const secret: Record<string, string> = { ...r.secret };

  // The R2 pair is MinIO's, which has to work; the rest are made up.
  for (const key of PRODUCTION_SECRET_KEYS) {
    secret[key] = generated();
  }

  secret.cloudflareR2AccessKey = MINIO_USER;
  secret.cloudflareR2Secret = r.config.minioPassword;

  await seedSecret(r.config, secret);
  await createBuckets(r.config);
  r.results.record(
    name,
    'Throwaway PostgreSQL 18, Redis, MinIO and Secrets Manager up',
    'PASS',
    secondsSince(started),
  );

  // Production's configuration expects the schema to be there, as it is.
  await r.db.query('CREATE SCHEMA IF NOT EXISTS "sto_info_app"');

  // Production's migrations, in two parts with a site admin made between:
  // its SeedStorytimeTags records one as the tags' owner.
  let at = Date.now();
  let migrated = await productionMigrations(r, BEFORE_STORYTIME_TAGS);

  if (migrated.code === 0) {
    await r.db.query(
      `INSERT INTO "sto_info_app"."user" ("id", "email", "password", "emailVerified", "role") VALUES ($1, $2, $3, true, 'ADMIN')`,
      [r.adminId, r.adminEmail, await bcrypt.hash(r.adminPassword, 10)],
    );
    await r.db.query(
      `INSERT INTO "sto_info_app"."user_profile" ("userId", "username", "firstName", "lastName") VALUES ($1, 'ReleaseRehearsalAdmin', 'Release', 'Admin')`,
      [r.adminId],
    );
    migrated = await productionMigrations(r);
  }

  const head = await r.db.value<string>(
    `SELECT max("timestamp")::text AS "value" FROM "sto_info_app"."_migrations"`,
  );

  if (
    !r.results.check(
      name,
      `${r.config.oldBackendRef}'s own migrations make its schema`,
      migrated.code === 0 && head === String(PRODUCTION_HEAD),
      secondsSince(at),
      migrated.code === 0
        ? `last migration ${head}`
        : failureOf(migrated.output),
    )
  ) {
    throw new Error("production's migrations failed");
  }

  at = Date.now();
  const seeded = await psqlFile(
    r,
    join(
      r.config.repo,
      'scripts',
      'release-rehearsal',
      'sql',
      'production-seed.sql',
    ),
    r.db.name,
  );
  const counts = await r.db.query<{
    users: number;
    accounts: number;
    characters: number;
    news: number;
  }>(
    `SELECT (SELECT count(*)::int FROM "sto_info_app"."user") AS "users",
            (SELECT count(*)::int FROM "sto_info_app"."account") AS "accounts",
            (SELECT count(*)::int FROM "sto_info_app"."character") AS "characters",
            (SELECT count(*)::int FROM "sto_info_app"."news_post") AS "news"`,
  );

  if (
    !r.results.check(
      name,
      'Production-shaped rows added (sql/production-seed.sql)',
      seeded.code === 0,
      secondsSince(at),
      seeded.code === 0
        ? `${counts[0].users} members, ${counts[0].accounts} accounts, ${counts[0].characters} Characters, ${counts[0].news} news posts`
        : seeded.output.trim().slice(0, 300),
    )
  ) {
    throw new Error('the seed failed');
  }

  const preflight = await psqlFile(
    r,
    join(r.config.repo, 'scripts', 'release-preflight', 'preflight.sql'),
    r.db.name,
    { schema: 'sto_info_app' },
  );

  r.results.check(
    name,
    'The preflight passes',
    preflight.code === 0 && preflight.output.includes('PREFLIGHT PASSED'),
    null,
    preflight.code === 0 ? '' : preflight.output.trim().slice(-300),
  );

  for (const line of preflight.output.matchAll(/INFO\s+(\w+)\s+(\d+)/g)) {
    r.results.record(name, `Preflight: ${line[1]}`, 'INFO', null, line[2]);
  }

  // The copy every comparison is made against, and every failure planted in.
  await r.db.close();
  await copyDatabase(r, BEFORE, r.db.name);
}

/**
 * R2: this release's migrations, timed.
 *
 * @param r - The rehearsal.
 */
async function migrate(r: Rehearsal): Promise<void> {
  const name = 'R2 Migrating to this release';
  const pending = readdirSync(
    join(r.config.repo, 'src', 'database', 'migrations'),
  ).filter(
    file =>
      /^\d{13}-.*\.ts$/.test(file) &&
      Number(file.slice(0, 13)) > PRODUCTION_HEAD,
  ).length;
  const at = Date.now();
  const migrated = await r.backendMigrations('migration:run', r.db.name);
  const ran = await r.db.value<number>(
    `SELECT count(*)::int AS "value" FROM "sto_info_app"."_migrations" WHERE "timestamp" > ${PRODUCTION_HEAD}`,
  );

  if (
    !r.results.check(
      name,
      `Every migration since ${r.config.oldBackendRef} applied, in one transaction`,
      migrated.code === 0 && ran === pending,
      secondsSince(at),
      migrated.code === 0 ? `${ran} of ${pending}` : failureOf(migrated.output),
    )
  ) {
    throw new Error("this release's migrations failed");
  }
}

/**
 * R3: everything that existed before is still there, save the changes the
 * release makes on purpose, which are checked one by one.
 *
 * @param r - The rehearsal.
 */
async function preserved(r: Rehearsal): Promise<void> {
  const name = 'R3 Nothing accepted is lost';
  const before = new Database(r.config, BEFORE);

  try {
    const [old, current] = await Promise.all([
      columnsOf(before),
      columnsOf(r.db),
    ]);
    const differing: string[] = [];
    let rows = 0;
    let tables = 0;

    for (const [table, columns] of old) {
      if (NOT_HISTORY.has(table)) {
        continue;
      }

      const now = current.get(table);

      if (now === undefined) {
        differing.push(`${table} is gone`);
        continue;
      }

      const kept = [...columns.keys()].filter(column => now.has(column));
      const where = ADDED_ROWS[table] ?? 'true';
      const [was, is] = await Promise.all([
        fingerprint(
          before,
          table,
          kept.map(column => INTENDED[`${table}.${column}`] ?? `"${column}"`),
        ),
        fingerprint(
          r.db,
          table,
          kept.map(column => `"${column}"`),
          where,
        ),
      ]);

      tables += 1;
      rows += was.rows;

      if (was.rows !== is.rows || was.hash !== is.hash) {
        differing.push(`${table} (${was.rows} rows before, ${is.rows} after)`);
      }
    }

    r.results.check(
      name,
      'Every table, every row and every column that remains is as it was, but for the intended changes below',
      differing.length === 0,
      null,
      differing.length === 0
        ? `${tables} tables, ${rows} rows compared`
        : differing.join('; '),
    );

    // The intended changes, one at a time.
    const moved = await before.value<number>(
      `SELECT count(*)::int AS "value" FROM "sto_info_app"."user_profile" WHERE "privacyMode" = true OR "sessionTimeoutMinutes" IS NOT NULL`,
    );
    const [wasPrefs, isPrefs] = await Promise.all([
      fingerprint(
        before,
        'user_profile',
        [`"userId"`, `"privacyMode"`, `"sessionTimeoutMinutes"`],
        `"privacyMode" = true OR "sessionTimeoutMinutes" IS NOT NULL`,
      ),
      fingerprint(r.db, 'user_preference', [
        `"userId"`,
        `"privacyMode"`,
        `"sessionTimeoutMinutes"`,
      ]),
    ]);

    r.results.check(
      name,
      'Privacy mode and session timeouts moved to user_preference, exactly',
      wasPrefs.hash === isPrefs.hash && isPrefs.rows === moved,
      null,
      `${isPrefs.rows} of ${moved}`,
    );

    const news = await r.db.query<{
      total: number;
      global: number;
      scoped: number;
    }>(
      `SELECT count(*)::int AS "total",
              count(*) FILTER (WHERE "communityId" IS NULL AND "fleetId" IS NULL AND "armadaId" IS NULL AND "audience" IS NULL AND "category" IS NOT NULL)::int AS "global",
              count(*) FILTER (WHERE "communityId" IS NOT NULL)::int AS "scoped"
         FROM "sto_info_app"."news_post"`,
    );

    r.results.check(
      name,
      'Every news post is still the site’s own, in its category',
      news[0].global === news[0].total && news[0].scoped === 0,
      null,
      `${news[0].global} of ${news[0].total} global`,
    );

    const notice = await r.db.value<string>(
      `SELECT "target"::text AS "value" FROM "sto_info_app"."notification" WHERE "id" = $1`,
      [POLICY_NOTICE_ID],
    );

    r.results.check(
      name,
      'One new notification: the policy notice, to everybody',
      notice === 'BROADCAST',
      null,
      notice ?? 'missing',
    );

    const switches = await r.db.query<{ key: string; value: string }>(
      `SELECT "key", "value" FROM "sto_info_app"."app_setting" ORDER BY "key"`,
    );
    const setting = (key: string) =>
      switches.find(row => row.key === key)?.value;

    r.results.check(
      name,
      'Fleet Communities is off; Storytime and Custom Tracking as they were; publication running',
      setting('FLEET_COMMUNITIES_ENABLED') === 'false' &&
        setting('STORYTIME_ENABLED') === 'true' &&
        setting('CUSTOM_TRACKING_ENABLED') === 'true' &&
        setting('FILE_PUBLICATION_PAUSED') === '{"paused":false}',
      null,
      switches.map(row => `${row.key}=${row.value}`).join(', '),
    );

    const names = await before.value<number>(
      `SELECT count(*)::int AS "value" FROM "sto_info_app"."character"
        WHERE "profilePictureId" IS NOT NULL AND POSITION('/' IN "profilePictureId") = 0 AND "profilePictureId" !~* '${CHARACTER_PICTURE_SHAPE}'`,
    );
    const legacy = await before.value<number>(
      `SELECT count(*)::int AS "value" FROM (
         SELECT "profilePictureId" AS "key" FROM "sto_info_app"."user_profile"
         UNION SELECT "profilePictureId" FROM "sto_info_app"."character"
           WHERE POSITION('/' IN "profilePictureId") > 0 OR "profilePictureId" ~* '${CHARACTER_PICTURE_SHAPE}'
         UNION SELECT "bannerImageId" FROM "sto_info_app"."storytime_arc"
         UNION SELECT "profileImageId" FROM "sto_info_app"."storytime_arc"
         UNION SELECT "bannerImageId" FROM "sto_info_app"."storytime_story"
         UNION SELECT "profileImageId" FROM "sto_info_app"."storytime_story"
         UNION SELECT "coverImageId" FROM "sto_info_app"."storytime_chapter"
         UNION SELECT "portraitImageId" FROM "sto_info_app"."storytime_character"
         UNION SELECT "overrideImageId" FROM "sto_info_app"."storytime_spotlight"
         UNION SELECT "cloudflareImageId" FROM "sto_info_app"."custom_tracking_image_value") AS pictures
        WHERE "key" IS NOT NULL`,
    );
    const assets = await r.db.query<{
      total: number;
      unverified: number;
      referenced: number;
    }>(
      `SELECT count(*)::int AS "total",
              count(*) FILTER (WHERE "state" = 'UNVERIFIED')::int AS "unverified",
              count(*) FILTER (WHERE "deliveryReference" = "objectKey")::int AS "referenced"
         FROM "sto_info_app"."file_asset"`,
    );

    r.results.check(
      name,
      'Every legacy picture is registered once, unverified, and no Character name is',
      assets[0].total === legacy &&
        assets[0].unverified === legacy &&
        assets[0].referenced === legacy,
      null,
      `${assets[0].total} registered of ${legacy} legacy pictures; ${names} Character(s) named as their picture cleared`,
    );

    const audit = await r.db.query<{ entity: string; keys: string }>(
      `SELECT "entity", (SELECT string_agg(key, ',' ORDER BY key) FROM json_each(coalesce("newValue", "oldValue"))) AS "keys"
         FROM "sto_info_app"."_audit" WHERE "entityId" LIKE '0a0a0a0a-%' ORDER BY "entity"`,
    );

    r.results.check(
      name,
      'Audit snapshots of news, contact requests and member reports keep their identifiers only; others are untouched',
      audit.every(row =>
        row.entity === 'CharacterEntity'
          ? row.keys === 'handle,id'
          : !/(^|,)(title|email|message|details)(,|$)/.test(row.keys),
      ),
      null,
      audit.map(row => `${row.entity}: ${row.keys}`).join('; '),
    );

    await r.db.inRolledBackTransaction(async runner => {
      let refused: string | null = null;

      try {
        await runner.query(
          `UPDATE "sto_info_app"."character" SET "profilePictureId" = 'production-00000000-0000-4000-8000-000000000000-character-unscanned' WHERE "id" = (SELECT "id" FROM "sto_info_app"."character" LIMIT 1)`,
        );
      } catch (error: unknown) {
        refused = sqlState(error);
      }

      r.results.check(
        name,
        'A picture nothing registered cannot be written',
        refused === PUBLISHED_IMAGE_GUARD_SQLSTATE,
        null,
        refused ?? 'accepted',
      );
    });

    await r.db.inRolledBackTransaction(async runner => {
      let refused: string | null = 'none';

      try {
        await runner.query(
          `UPDATE "sto_info_app"."platform" SET "name" = 'Windows (renamed)' WHERE "name" = 'Windows'`,
        );
        refused = null;
      } catch (error: unknown) {
        refused = sqlState(error);
      }

      r.results.check(
        name,
        'A platform no Fleet is on yet can still be renamed',
        refused === null,
        null,
        refused ?? 'renamed',
      );
    });
  } finally {
    await before.close();
  }
}

/**
 * R4: this release boots with Fleet Community off, and a site admin turns
 * it on and off from the feature switches, with news and members untouched.
 *
 * @param r - The rehearsal.
 */
async function featureSwitch(r: Rehearsal): Promise<void> {
  const name = 'R4 Feature switch smoke test';
  const at = Date.now();

  r.startBackend('release');
  r.results.record(
    name,
    'This release boots on the migrated database',
    'PASS',
    await r.backendReady(),
    'from process start',
  );

  const anonymous = new Api(r.config.ports.backend);
  const fleetOn = async (): Promise<boolean> => {
    const answer = await anonymous.call<{ features?: { isEnabled?: boolean } }>(
      'GET',
      '/fleet/configuration',
    );

    return answer.body.features?.isEnabled === true;
  };
  const directory = async (): Promise<number> =>
    (await anonymous.call('GET', '/fleet-communities')).status;
  const newsSlugs = async (): Promise<string> =>
    JSON.stringify((await anonymous.call('GET', '/news')).body);

  const newsBefore = await newsSlugs();

  r.results.check(
    name,
    'Site news is served: the published post, not the draft',
    newsBefore.includes('release-rehearsal-published') &&
      !newsBefore.includes('release-rehearsal-draft'),
  );

  const member = await r.db.value<string>(
    `SELECT "email" AS "value" FROM "sto_info_app"."user" WHERE "email" LIKE 'demo-user-%' ORDER BY "email" LIMIT 1`,
  );
  const signedIn = await new Api(r.config.ports.backend)
    .signIn(member!, r.applicantPassword)
    .then(
      () => true,
      () => false,
    );

  r.results.check(
    name,
    'A member from before the release signs in with their password',
    signedIn,
  );
  r.results.check(
    name,
    'Fleet Community is off, and its routes answer as though it did not exist',
    !(await fleetOn()) && (await directory()) === 404,
  );

  await r.api.signIn(r.adminEmail, r.adminPassword);

  const listed = await r.api.call<{ feature: string; isEnabled: boolean }[]>(
    'GET',
    '/admin/feature-switches',
  );

  r.results.check(
    name,
    'The feature switches show Fleet off, Storytime and Custom Tracking on',
    listed.status === 200 &&
      listed.body
        .map(entry => `${entry.feature}=${entry.isEnabled}`)
        .join(',') ===
        'FLEET_COMMUNITIES=false,STORYTIME=true,CUSTOM_TRACKING=true',
    null,
    JSON.stringify(
      listed.body.map?.(entry => [entry.feature, entry.isEnabled]) ??
        listed.body,
    ),
  );

  /**
   * Throws the switch from the feature switches, and waits until Fleet
   * Community answers, or stops answering, accordingly.
   *
   * @param isEnabled - Which way.
   * @returns The answer's status and how long it took to take effect.
   */
  const flip = async (
    isEnabled: boolean,
  ): Promise<{ status: number; seconds: number }> => {
    const since = Date.now();
    const answer = await r.api.call(
      'PATCH',
      '/admin/feature-switches/FLEET_COMMUNITIES',
      { isEnabled, reason: REASON },
    );

    await waitFor(
      `Fleet Community to ${isEnabled ? 'answer' : 'go'}`,
      async () =>
        (await fleetOn()) === isEnabled &&
        (await directory()) === (isEnabled ? 200 : 404),
      30_000,
      500,
    );

    return { status: answer.status, seconds: secondsSince(since) };
  };

  let flipped = await flip(true);

  r.results.check(
    name,
    'Switched on with a reason, Fleet Community answers within ten seconds',
    flipped.status === 200,
    flipped.seconds,
  );

  const again = await r.api.call(
    'PATCH',
    '/admin/feature-switches/FLEET_COMMUNITIES',
    { isEnabled: true, reason: REASON },
  );

  r.results.check(
    name,
    'Switching it on again is refused, as already on',
    again.status === 409,
    null,
    String(again.status),
  );

  // Something to keep: a Community and a Fleet registered while it is on.
  const windows = await r.db.value<string>(
    `SELECT "id"::text AS "value" FROM "sto_info_app"."platform" WHERE "name" = 'Windows'`,
  );
  const community = await r.api.call<{ id?: string }>(
    'POST',
    '/fleet-communities',
    { name: 'Release Rehearsal Community' },
  );
  const fleet = await r.api.call(
    'POST',
    `/fleet-communities/${community.body.id}/fleets`,
    { exactGameName: 'Release Rehearsal Fleet', platformId: windows },
  );
  const communityPath = `/fleet-communities/${community.body.id}`;
  const kept = async (): Promise<number> =>
    (await r.db.value<number>(
      `SELECT ((SELECT count(*) FROM "sto_info_app"."fleet_community" WHERE "id" = $1)
            + (SELECT count(*) FROM "sto_info_app"."sto_fleet" WHERE "communityId" = $1))::int AS "value"`,
      [community.body.id],
    )) ?? 0;

  r.results.check(
    name,
    'A Community and a Fleet are registered while it is on',
    community.status === 201 && fleet.status === 201 && (await kept()) === 2,
    null,
    `${community.status}, ${fleet.status}`,
  );

  await r.db.inRolledBackTransaction(async runner => {
    let refused: string | null = null;

    try {
      await runner.query(
        `UPDATE "sto_info_app"."platform" SET "name" = 'Windows (renamed)' WHERE "name" = 'Windows'`,
      );
    } catch (error: unknown) {
      refused = sqlState(error);
    }

    r.results.check(
      name,
      'Renaming a platform a Fleet is on is refused',
      refused === PLATFORM_RENAME_GUARD_SQLSTATE,
      null,
      refused ?? 'renamed',
    );
  });

  flipped = await flip(false);

  const hidden = (await r.api.call('GET', communityPath)).status;

  r.results.check(
    name,
    'Switched off, its routes disappear within ten seconds and what was registered is kept',
    flipped.status === 200 && hidden === 404 && (await kept()) === 2,
    flipped.seconds,
    `the Community answered ${hidden}`,
  );

  flipped = await flip(true);

  const back = (await r.api.call('GET', communityPath)).status;

  r.results.check(
    name,
    'Switched on again, the Community is back as it was',
    flipped.status === 200 && back === 200,
    flipped.seconds,
    `the Community answered ${back}`,
  );

  // Off, as the release leaves it until the release checklist is done.
  flipped = await flip(false);
  r.results.check(
    name,
    'Switched off once more, as the release is deployed',
    flipped.status === 200,
    flipped.seconds,
  );

  r.results.check(
    name,
    'Site news is served unchanged throughout',
    (await newsSlugs()) === newsBefore,
  );

  const logged = await r.db.query<{
    action: string;
    reason: string;
    subject: string;
  }>(
    `SELECT "action"::text AS "action", "reason", "subjectKind" || ':' || "subjectId" AS "subject"
       FROM "sto_info_app"."site_admin_action" WHERE "action"::text LIKE 'FEATURE_SWITCHED_%' ORDER BY "createdAt"`,
  );

  r.results.check(
    name,
    'Every change is in the Security Log, with the reason; the refused one is not',
    logged.map(row => row.action).join(',') ===
      'FEATURE_SWITCHED_ON,FEATURE_SWITCHED_OFF,FEATURE_SWITCHED_ON,FEATURE_SWITCHED_OFF' &&
      logged.every(
        row =>
          row.reason === REASON &&
          row.subject === 'FEATURE_SWITCH:FLEET_COMMUNITIES',
      ),
    secondsSince(at),
    logged.map(row => row.action).join(', '),
  );

  await r.backend?.kill();
}

/**
 * R5: the ways back. The newest migrations revert where they may and refuse
 * where history would be lost; then the production release is booted on the
 * migrated database, which the rollback runbook forbids, to record why.
 *
 * @param r - The rehearsal.
 */
async function rollback(r: Rehearsal): Promise<void> {
  const name = 'R5 Rolling back';

  await r.db.close();
  await copyDatabase(r, REVERT, r.db.name);

  const steps: string[] = [];
  let refusal = '';

  for (let step = 0; step < 4; step += 1) {
    const reverted = await r.backendMigrations('migration:revert', REVERT);
    const which = /Migration (\w+) has been reverted/.exec(
      reverted.output,
    )?.[1];

    if (reverted.code !== 0) {
      refusal = reverted.output;
      break;
    }

    steps.push(which ?? '?');
  }

  r.results.check(
    name,
    'migration:revert undoes the platform guard and the name clearing, then refuses once the Security Log holds a feature switch',
    steps.join(',') ===
      'GuardPlatformRenames1797900000000,ClearCharacterNamesFromPictures1797800000000' &&
      refusal.includes(FEATURE_SWITCH_ACTIONS_DOWN_REFUSAL.slice(0, 60)),
    null,
    `reverted ${steps.join(', ') || 'nothing'}; then ${failureOf(refusal).slice(0, 160)}`,
  );

  const forward = await r.backendMigrations('migration:run', REVERT);

  r.results.check(
    name,
    'migration:run brings it forward again',
    forward.code === 0,
    null,
    forward.code === 0 ? '' : failureOf(forward.output),
  );

  // The production release on the migrated database, with the old secret
  // names still present, as at the moment of release.
  const { build } = production(r);
  const since = Date.now();

  r.startBackend('production-release', join(build, 'src', 'main.js'));

  const ready = await r.backendReady(120_000).then(
    seconds => seconds,
    () => null,
  );
  const old = new Api(r.config.ports.backend);
  const member = await r.db.value<string>(
    `SELECT "email" AS "value" FROM "sto_info_app"."user" WHERE "email" LIKE 'demo-user-%' ORDER BY "email" LIMIT 1`,
  );
  const news = ready === null ? 0 : (await old.call('GET', '/news')).status;
  const signIn =
    ready === null
      ? 0
      : (
          await old.call('POST', '/auth/login', {
            email: member,
            password: r.applicantPassword,
          })
        ).status;

  r.results.record(
    name,
    `${r.config.oldBackendRef} booted on the migrated database (the runbook forbids rolling production back below this release)`,
    'INFO',
    ready ?? secondsSince(since),
    ready === null
      ? 'did not become ready'
      : `news answered ${news}; a member's sign-in answered ${signIn}`,
  );

  await r.backend?.kill();
}

/**
 * R6: each row the preflight looks for, planted in a copy of the database as
 * it was before the release, is found by the preflight and fails the
 * migrations, which then leave the copy exactly as it was.
 *
 * @param r - The rehearsal.
 */
async function preflightProofs(r: Rehearsal): Promise<void> {
  const name = 'R6 What the preflight looks for';
  const plants: [string, string][] = [
    [
      'AUDIT_NOT_OBJECT',
      `INSERT INTO "sto_info_app"."_audit" ("entity", "action", "entityId", "oldValue") VALUES ('NewsPostEntity', 'UPDATE', 'x', '[1, 2]')`,
    ],
    [
      'PROFILE_PICTURE_TOO_LONG',
      `UPDATE "sto_info_app"."user_profile" SET "profilePictureId" = 'production-' || repeat('b', 300) WHERE "userId" = (SELECT "userId" FROM "sto_info_app"."user_profile" ORDER BY "username" LIMIT 1)`,
    ],
    [
      'PICTURE_IN_BOTH_STORES',
      `UPDATE "sto_info_app"."storytime_chapter" SET "coverImageId" = (SELECT "profilePictureId" FROM "sto_info_app"."character" WHERE POSITION('/' IN "profilePictureId") > 0 LIMIT 1)`,
    ],
    [
      'NOTICE_ID_TAKEN',
      `INSERT INTO "sto_info_app"."notification" ("id", "title", "body") VALUES ('${POLICY_NOTICE_ID}', 'Taken', 'Taken')`,
    ],
  ];

  for (const [check, plant] of plants) {
    const database = `release_${check.toLowerCase()}`;

    await copyDatabase(r, database, BEFORE);

    const db = new Database(r.config, database);

    try {
      await db.query(plant);

      const tablesBefore = await db.value<number>(
        `SELECT count(*)::int AS "value" FROM information_schema.tables WHERE "table_schema" = 'sto_info_app'`,
      );
      const preflight = await psqlFile(
        r,
        join(r.config.repo, 'scripts', 'release-preflight', 'preflight.sql'),
        database,
        { schema: 'sto_info_app' },
      );
      const found = new RegExp(`FAIL\\s+${check}\\s+[1-9]`).test(
        preflight.output,
      );

      await db.close();

      const migrated = await r.backendMigrations('migration:run', database);
      const head = await db.value<string>(
        `SELECT max("timestamp")::text AS "value" FROM "sto_info_app"."_migrations"`,
      );
      const tablesAfter = await db.value<number>(
        `SELECT count(*)::int AS "value" FROM information_schema.tables WHERE "table_schema" = 'sto_info_app'`,
      );

      r.results.check(
        name,
        `${check}: the preflight fails on it, the migrations fail on it, and nothing changes`,
        preflight.code !== 0 &&
          found &&
          migrated.code !== 0 &&
          head === String(PRODUCTION_HEAD) &&
          tablesAfter === tablesBefore,
        null,
        `preflight ${preflight.code === 0 ? 'passed' : 'failed'}; migrations ${migrated.code === 0 ? 'ran' : `failed: ${failureOf(migrated.output).slice(0, 120)}`}; last migration ${head}`,
      );
    } finally {
      await db.close();
      await r.containers
        .exec('pg', `dropdb -U postgres --if-exists ${database}`)
        .catch(() => undefined);
    }
  }
}

/**
 * Runs one part, recording it as failed if it throws, so the next still runs.
 *
 * @param r - The rehearsal.
 * @param name - The part.
 * @param body - What it does.
 */
async function part(
  r: Rehearsal,
  name: string,
  body: () => Promise<void>,
): Promise<void> {
  console.log(`\n--- ${name} ---`);

  try {
    await body();
  } catch (error: unknown) {
    r.results.record(
      name,
      'Stopped early',
      'FAIL',
      null,
      error instanceof Error ? error.message : String(error),
    );
    await r.backend?.kill().catch(() => undefined);
  }
}

/**
 * Runs the rehearsal and writes the results.
 */
async function main(): Promise<void> {
  const r = new Rehearsal('Release rehearsal results (FC-045)');
  const started = new Date();

  // The Fleet fixtures the local seeds make are given nothing to seed, as in
  // production; the demo members' password is the rehearsal's own.
  const environment = r.backendEnvironment.bind(r);

  r.backendEnvironment = (build, checkout) => {
    const env = environment(build, checkout);

    delete env.DATASEED_FLEET_APPLICANT_EMAIL;
    delete env.DATASEED_FLEET_APPLICANT_USERNAME;
    delete env.DATASEED_FLEET_APPLICANT_PASSWORD;

    return env;
  };

  await r.egress.listen(r.config.ports.egress);

  try {
    await part(r, 'R1 Production as it is', () => production1(r));

    if (r.results.failures === 0) {
      await part(r, 'R2 Migrating to this release', () => migrate(r));
    }

    if (r.results.failures === 0) {
      await part(r, 'R3 Nothing accepted is lost', () => preserved(r));
      await part(r, 'R4 Feature switch smoke test', () => featureSwitch(r));
      await part(r, 'R5 Rolling back', () => rollback(r));
      await part(r, 'R6 What the preflight looks for', () =>
        preflightProofs(r),
      );
    }

    r.results.record(
      'All',
      'Outbound calls refused by the egress guard',
      'INFO',
      null,
      r.egress.attemptsSince().join(', ') || 'none',
    );
  } finally {
    await r.stopApps();
    await r.db.close();
    await r.egress.close();

    const logsCopy = `${r.config.results.replace(/\.md$/, '')}-logs`;

    mkdirSync(logsCopy, { recursive: true });

    for (const file of readdirSync(r.logs)) {
      copyFileSync(join(r.logs, file), join(logsCopy, file));
    }

    r.results.write(r.config.results, [
      `Run ${started.toISOString()} to ${new Date().toISOString()} on ${process.platform}, Node ${process.version}.`,
      '',
      `- Production release: ${r.config.oldBackendRef}, built from git archive; this release: ${r.config.repo} (working tree as built).`,
      '- Throwaway PostgreSQL 18, Redis, MinIO and Secrets Manager; synthetic data only (production demo seed plus sql/production-seed.sql).',
      `- Buckets: ${Object.values(BUCKETS).join(', ')} in MinIO. Nothing could reach the internet.`,
      `- Application and migration logs: ${logsCopy}`,
    ]);
    console.log(`\nResults written to ${r.config.results}`);
  }

  if (r.results.failures > 0) {
    throw new Error(`${r.results.failures} check(s) failed`);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
