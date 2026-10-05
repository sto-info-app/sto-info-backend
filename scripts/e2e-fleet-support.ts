/**
 * Disposable people for the frontend's Fleet journeys (FC-044).
 *
 * The Fleet journeys sign in as several people at once — an Owner, an
 * applicant, a friend, an Officer, a stranger and a site admin — and build
 * Communities, Fleets, Armadas, imports, events, chat and reports through the
 * interface. Steve chose on 2 October 2026 that they do it as people made for
 * the run and removed after it, on the local stack, so his own data is never
 * touched and no password of his is ever needed.
 *
 * - `fleet-begin <file>` removes whatever an earlier run left, switches Fleet
 *   Community on, makes the people with passwords generated here, and writes
 *   who they are, passwords included, to `<file>`. The file belongs in a
 *   folder git ignores; the passwords are never printed.
 * - `fleet-flag <on|off>` throws the master switch, for the journey about a
 *   Fleet Community switched off. The server reads it within ten seconds.
 * - `fleet-finish <file>` removes every person whose address is at
 *   `fc044.example`, from any run, and everything they made, and puts the
 *   switch back as `fleet-begin` found it.
 * - `fleet-counts` says how much of that is left: nothing, after a finish.
 * - `fleet-clear-communities` removes the people's Communities and keeps the
 *   people, before each journey file: an Owner may hold only ten. It also
 *   forgets this machine's rate limit counts.
 * - `fleet-start <occurrence>` puts one of their events' occurrences under
 *   way, so its attendance sheet opens.
 * - `fleet-rescan-queue <pause|resume>` holds a rescan campaign open long
 *   enough to be paused, resumed and cancelled.
 * - `fleet-storytime <on|off|restore> [file]` throws Storytime's switch, or
 *   puts it back as `fleet-begin` found it, as `fleet-finish` also does.
 * - `fleet-proposal-notices <email> <hold|release> [waitSeconds]` holds a
 *   person's roster proposal notices from the outbox while they answer.
 * - `fleet-dm-notices <email>` counts a person's direct message notices
 *   without opening a page of theirs.
 * - `fleet-review-holds <reasonPrefix>` and `fleet-expire-export <importId>`
 *   bring a hold to its review date, or a held export to the end of its
 *   retention, and run the scheduled job that acts on it. These two start
 *   the application, with its own schedule stopped.
 *
 * Their addresses are at a domain reserved for testing, which the mail
 * service never sends to, so signing in sends nobody anything.
 *
 * It refuses to run unless the database is on this machine, and, but for the
 * two commands that run a job, it uses a plain connection rather than the
 * application, so it needs nothing but the database and Redis.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import type { INestApplicationContext } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import bcrypt from 'bcrypt';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';

import { getTypeOrmConfig } from '../config/typeorm.config';
import { RESCAN_CAMPAIGN_QUEUE } from '../src/file-scanning/rescan/rescan.constants';
import { FleetRetentionScheduler } from '../src/fleet/retention/fleet-retention.scheduler';
import { OUTBOX_ATTEMPTS } from '../src/notification/outbox/notification-outbox.service';

const SCHEMA = process.env.DB_SCHEMA ?? 'sto_info_app';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FLEET_SWITCH = 'FLEET_COMMUNITIES_ENABLED';
const STORYTIME_SWITCH = 'STORYTIME_ENABLED';

/** Every disposable person's address ends with this. */
export const DISPOSABLE_DOMAIN = 'fc044.example';

/** Who the journeys need, and what each is for. */
const ROLES = [
  // Registers Communities, Fleets and Armadas, and imports rosters.
  'owner',
  // Applies to a Fleet, is approved, answers events and chats.
  'applicant',
  // A friend of the Owner's, for direct messages, presence and blocks.
  'friend',
  // Made an Officer during the journey.
  'officer',
  // Signed in, and nothing to anybody.
  'stranger',
  // A site administrator, for moderation and investigations.
  'admin',
] as const;

type Role = (typeof ROLES)[number];

/** One disposable person, as the journeys sign in. */
interface DisposablePerson {
  readonly id: string;
  readonly email: string;
  readonly username: string;
  readonly password: string;
  /** Their STO account's handle and their Character's name. */
  readonly accountHandle: string;
  readonly characterName: string;
}

/** What `fleet-begin` writes for the journeys. */
interface DisposableWorld {
  readonly run: string;
  /** The master switch as it was found, to put back. */
  readonly switchWas: string | null;
  /** Storytime's switch as it was found, to put back. */
  readonly storytimeWas?: string | null;
  readonly people: Record<Role, DisposablePerson>;
}

type Result = Record<string, unknown>;

/**
 * Connects, refusing anything but a database on this machine.
 *
 * @returns The connection.
 * @throws Error when the database is elsewhere.
 */
async function connect(): Promise<DataSource> {
  if (!LOCAL_HOSTS.has(process.env.DB_HOST ?? '')) {
    throw new Error(
      `The Fleet journeys' people are made only in a database on this machine, not on ${process.env.DB_HOST}.`,
    );
  }

  const source = new DataSource({
    ...(await getTypeOrmConfig()),
    entities: [],
    migrations: [],
    logging: false,
  });

  await source.initialize();

  return source;
}

/**
 * Forgets this machine's counts under the rate limits, so a second run within
 * fifteen minutes is not refused for the first run's sign-ins, nor a journey
 * file for the writes of the files before it: every disposable person writes
 * from this one address, which the write limit allows two hundred in fifteen
 * minutes. Only keys for this machine's own addresses go.
 *
 * @param scopes - Which limits: `auth` for sign-ins, `*` for all of them.
 * @returns How many counts were forgotten.
 */
async function forgetLocalRateCounts(scopes = 'auth'): Promise<number> {
  if (!process.env.REDIS_URL) {
    return 0;
  }

  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });

  try {
    const keys = await redis.keys(`rl:${scopes}:*`);
    const local = keys.filter(
      key =>
        key.includes('127.0.0.1') || key.includes('::1') || key.includes('::/'),
    );

    if (local.length > 0) {
      await redis.del(...local);
    }

    return local.length;
  } finally {
    redis.disconnect();
  }
}

/**
 * Deletes rows, and first whatever a foreign key says still refers to them.
 *
 * PostgreSQL names the constraint that refused, so the rows in the way are
 * found from the catalogue rather than from a list kept here that would go
 * stale with the next migration.
 *
 * @param db - The connection.
 * @param table - The table, schema-qualified and quoted.
 * @param where - Which rows, as SQL.
 * @param params - The condition's parameters.
 * @param depth - How far down this has gone, to stop a cycle.
 */
async function remove(
  db: DataSource,
  table: string,
  where: string,
  params: unknown[],
  depth = 0,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await db.query(`DELETE FROM ${table} WHERE ${where}`, params);

      return;
    } catch (error: unknown) {
      const failure = error as {
        code?: string;
        constraint?: string;
        driverError?: { code?: string; constraint?: string };
      };
      const code = failure.code ?? failure.driverError?.code;
      const constraint = failure.constraint ?? failure.driverError?.constraint;

      // 23503 foreign key; 23001 restrict, as PostgreSQL 18 reports it.
      if ((code !== '23503' && code !== '23001') || !constraint || depth > 12) {
        throw error;
      }

      const [reference] = (await db.query(
        `SELECT format('%I.%I', child_ns.nspname, child.relname) AS "child",
                child_column.attname AS "childColumn",
                parent_column.attname AS "parentColumn"
           FROM pg_constraint c
           JOIN pg_class child ON child.oid = c.conrelid
           JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
           JOIN pg_attribute child_column
             ON child_column.attrelid = c.conrelid AND child_column.attnum = c.conkey[1]
           JOIN pg_attribute parent_column
             ON parent_column.attrelid = c.confrelid AND parent_column.attnum = c.confkey[1]
          WHERE c.conname = $1 AND c.contype = 'f'
          LIMIT 1`,
        [constraint],
      )) as Array<{ child: string; childColumn: string; parentColumn: string }>;

      if (!reference) {
        throw error;
      }

      await remove(
        db,
        reference.child,
        `"${reference.childColumn}" IN (SELECT "${reference.parentColumn}" FROM ${table} WHERE ${where})`,
        params,
        depth + 1,
      );
    }
  }

  throw new Error(`Could not clear the way to delete from ${table}`);
}

/**
 * Names every table in the schema with a given column.
 *
 * @param db - The connection.
 * @param column - The column.
 * @returns The tables, schema-qualified and quoted.
 */
async function tablesWith(db: DataSource, column: string): Promise<string[]> {
  const rows = (await db.query(
    `SELECT format('%I.%I', table_schema, table_name) AS "name"
       FROM information_schema.columns c
       JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = $1 AND c.column_name = $2 AND t.table_type = 'BASE TABLE'
      ORDER BY 1`,
    [SCHEMA, column],
  )) as Array<{ name: string }>;

  return rows.map(row => row.name);
}

/**
 * The disposable people in the database, from any run.
 *
 * @param db - The connection.
 * @returns Their IDs.
 */
async function disposableIds(db: DataSource): Promise<string[]> {
  const rows = (await db.query(
    `SELECT "id" FROM "${SCHEMA}"."user" WHERE lower("email") LIKE $1`,
    [`%@${DISPOSABLE_DOMAIN}`],
  )) as Array<{ id: string }>;

  return rows.map(row => row.id);
}

/**
 * Removes the disposable people's Communities, with every Fleet and Armada
 * in them and everything in those, but not the people.
 *
 * @param db - The connection.
 * @param people - Their IDs.
 * @param withTheirOwnFiles - Whether files they own outside any scope (a
 *   profile picture) go too, as they do when the people themselves go.
 * @returns How many Communities went.
 */
async function removeCommunities(
  db: DataSource,
  people: string[],
  withTheirOwnFiles: boolean,
): Promise<number> {
  const communities = (
    (await db.query(
      `SELECT "id" FROM "${SCHEMA}"."fleet_community" WHERE "ownerUserId" = ANY($1::uuid[])
        OR "id" IN (SELECT "communityId" FROM "${SCHEMA}"."scope_ownership_transfer"
                     WHERE "fromUserId" = ANY($1::uuid[]) OR "toUserId" = ANY($1::uuid[]))`,
      [people],
    )) as Array<{ id: string }>
  ).map(row => row.id);
  const fleets = (
    (await db.query(
      `SELECT "id" FROM "${SCHEMA}"."sto_fleet" WHERE "communityId" = ANY($1::uuid[])`,
      [communities],
    )) as Array<{ id: string }>
  ).map(row => row.id);
  const armadas = (
    (await db.query(
      `SELECT "id" FROM "${SCHEMA}"."sto_armada" WHERE "communityId" = ANY($1::uuid[])`,
      [communities],
    )) as Array<{ id: string }>
  ).map(row => row.id);
  const scopes = [...communities, ...fleets, ...armadas];

  // Their files, wherever they hang: the worker's attempts are in its own
  // schema, with nothing to cascade from.
  const assets = (
    (await db.query(
      `SELECT "id" FROM "${SCHEMA}"."file_asset"
        WHERE ($5 AND "ownerUserId" = ANY($1::uuid[])) OR "communityId" = ANY($2::uuid[])
           OR "fleetId" = ANY($3::uuid[]) OR "armadaId" = ANY($4::uuid[])`,
      [people, communities, fleets, armadas, withTheirOwnFiles],
    )) as Array<{ id: string }>
  ).map(row => row.id);
  const [{ attempts }] = (await db.query(
    `SELECT to_regclass('sto_info_worker.file_scan_attempt')::text AS "attempts"`,
  )) as Array<{ attempts: string | null }>;

  if (attempts !== null && assets.length > 0) {
    await db.query(
      `DELETE FROM "sto_info_worker"."file_scan_attempt" WHERE "assetId" = ANY($1::uuid[])`,
      [assets],
    );
  }

  // The membership log names the application that granted a membership, and
  // is write-once: deleting the application would null that name, which the
  // log refuses. Production never deletes an application; this does, so the
  // log entries go first.
  await db.query(
    `DELETE FROM "${SCHEMA}"."scope_membership_action"
      WHERE "applicationId" IN (
        SELECT "id" FROM "${SCHEMA}"."fleet_application"
         WHERE "fleetId" = ANY($1::uuid[]) OR "applicantUserId" = ANY($2::uuid[]))`,
    [fleets, people],
  );

  // Everything in their scopes, deepest dependants first as the database
  // finds them, then the scopes themselves.
  for (const [column, ids] of [
    ['fleetId', fleets],
    ['armadaId', armadas],
    ['communityId', communities],
  ] as const) {
    if (ids.length === 0) {
      continue;
    }

    for (const table of await tablesWith(db, column)) {
      await remove(db, table, `"${column}" = ANY($1::uuid[])`, [ids]);
    }
  }

  if (assets.length > 0) {
    await remove(db, `"${SCHEMA}"."file_asset"`, `"id" = ANY($1::uuid[])`, [
      assets,
    ]);
  }

  await remove(
    db,
    `"${SCHEMA}"."fleet_slug_history"`,
    `"targetId" = ANY($1::uuid[])`,
    [scopes],
  );

  for (const [table, ids] of [
    ['sto_fleet', fleets],
    ['sto_armada', armadas],
    ['fleet_community', communities],
  ] as const) {
    if (ids.length > 0) {
      await remove(db, `"${SCHEMA}"."${table}"`, `"id" = ANY($1::uuid[])`, [
        ids,
      ]);
    }
  }

  return communities.length;
}

/**
 * Removes every disposable person and everything they made.
 *
 * Their Communities go with everything in them; then their files, the
 * worker's record of scanning them, what they wrote and were sent, and they.
 * What the logs say about them stays, with their IDs nulled by the database,
 * because the logs are written once.
 *
 * @param db - The connection.
 * @returns How many people were removed.
 */
async function removeEverything(db: DataSource): Promise<Result> {
  const people = await disposableIds(db);

  if (people.length === 0) {
    return { people: 0, communities: 0 };
  }

  const communities = await removeCommunities(db, people, true);

  // A chat report outlives its message and channel, and the database only
  // nulls its reporter and author, so their reports would stay in the site
  // admin's queue, named for nobody, and fill its first page within a few
  // runs. Their evidence goes with them.
  await remove(
    db,
    `"${SCHEMA}"."chat_message_report"`,
    `"reporterUserId" = ANY($1::uuid[]) OR "authorUserId" = ANY($1::uuid[])`,
    [people],
  );

  // The same for the holds a site admin of theirs placed or they were the
  // subject of, and the rescan campaigns one started: each would stay on its
  // admin page, named for nobody.
  await remove(
    db,
    `"${SCHEMA}"."moderation_hold"`,
    `"ownerUserId" = ANY($1::uuid[]) OR "subjectUserId" = ANY($1::uuid[])`,
    [people],
  );
  await remove(
    db,
    `"${SCHEMA}"."file_rescan_campaign"`,
    `"startedByUserId" = ANY($1::uuid[])`,
    [people],
  );

  // What they wrote anywhere else, and what they were sent, which no foreign
  // key ties to them.
  for (const [table, column] of [
    ['chat_message', 'authorUserId'],
    ['notification_read', 'userId'],
    ['notification', 'userId'],
    ['user_profile', 'userId'],
    ['user_refresh_token', 'userId'],
  ] as const) {
    await remove(
      db,
      `"${SCHEMA}"."${table}"`,
      `"${column}" = ANY($1::uuid[])`,
      [people],
    );
  }

  await remove(db, `"${SCHEMA}"."user"`, `"id" = ANY($1::uuid[])`, [people]);

  return { people: people.length, communities };
}

/**
 * Makes one disposable person, with an STO account and a Character.
 *
 * @param db - The connection.
 * @param role - What they are for.
 * @param run - This run's mark.
 * @returns Them, password included.
 */
async function makePerson(
  db: DataSource,
  role: Role,
  run: string,
): Promise<DisposablePerson> {
  const label = `${role[0].toUpperCase()}${role.slice(1)}`;
  // Long and mixed, so the sign-in form's own rules accept it.
  const password = `Fc044-${randomBytes(12).toString('base64url')}!9a`;
  const email = `fc044-${role}-${run}@${DISPOSABLE_DOMAIN}`;
  const username = `Fc044${label}${run}`;
  const accountHandle = `fc044${role}${run}`;
  const characterName = `Fc044 ${label}`;
  const [{ id }] = (await db.query(
    `INSERT INTO "${SCHEMA}"."user" ("id", "email", "password", "emailVerified", "role")
     VALUES (gen_random_uuid(), $1, $2, true, $3) RETURNING "id"`,
    [
      email,
      await bcrypt.hash(password, Number(process.env.AUTH_SALT_ROUNDS ?? 10)),
      role === 'admin' ? 'ADMIN' : 'USER',
    ],
  )) as Array<{ id: string }>;

  await db.query(
    `INSERT INTO "${SCHEMA}"."user_profile" ("userId", "username", "firstName", "lastName", "publiclyVisible")
     VALUES ($1, $2, 'Fc044', $3, true)`,
    [id, username, label],
  );

  const [{ accountId }] = (await db.query(
    `INSERT INTO "${SCHEMA}"."account" ("id", "userId", "handle", "handleNormalized", "handleSlug", "platformId")
     SELECT gen_random_uuid(), $1, $2::varchar, lower($2::varchar), $2::varchar, "id"
       FROM "${SCHEMA}"."platform" WHERE "name" = 'Windows' AND "deletedAt" IS NULL
     RETURNING "id" AS "accountId"`,
    [id, accountHandle],
  )) as Array<{ accountId: string }>;
  const fullHandle = `${characterName}@${accountHandle}`;

  await db.query(
    `INSERT INTO "${SCHEMA}"."character"
       ("id", "accountId", "handle", "fullHandle", "fullHandleNormalized", "fullHandleSlug",
        "level", "generalFactionId", "factionId", "sexId", "classId", "speciesId")
     SELECT gen_random_uuid(), $1, $2::varchar, $3::varchar, lower($3::varchar), $3::varchar, 65,
            (SELECT "id" FROM "${SCHEMA}"."character_general_faction" WHERE "name" = 'Federation'),
            (SELECT "id" FROM "${SCHEMA}"."character_faction" WHERE "name" = 'Starfleet (2409)'),
            (SELECT "id" FROM "${SCHEMA}"."character_sex" WHERE "name" = 'Female'),
            (SELECT "id" FROM "${SCHEMA}"."character_class" WHERE "name" = 'Engineering'),
            (SELECT "id" FROM "${SCHEMA}"."character_species" WHERE "name" = 'Human')`,
    [accountId, characterName, fullHandle],
  );

  return { id, email, username, password, accountHandle, characterName };
}

/**
 * Starts a run: clears the last one, switches Fleet Community on, and makes
 * the people.
 *
 * @param db - The connection.
 * @param file - Where to write who they are.
 * @returns Who was made, without their passwords.
 */
async function begin(db: DataSource, file: string): Promise<Result> {
  if (!file) {
    throw new Error('fleet-begin needs the file to write the people to.');
  }

  const cleared = await removeEverything(db);
  let switchWas = await settingOf(db, FLEET_SWITCH);
  let storytimeWas = await settingOf(db, STORYTIME_SWITCH);

  // A run that stopped before its finish left the switches on; what it found
  // is in its own file.
  try {
    const earlier = JSON.parse(readFileSync(file, 'utf8')) as DisposableWorld;

    switchWas = earlier.switchWas ?? switchWas;
    storytimeWas = earlier.storytimeWas ?? storytimeWas;
  } catch {
    // No earlier file: the settings as they stand are the ones to restore.
  }

  await setSwitch(db, 'on');

  const run = randomBytes(3).toString('hex');
  const people = {} as Record<Role, DisposablePerson>;

  for (const role of ROLES) {
    people[role] = await makePerson(db, role, run);
  }

  // The Owner and their friend, for direct messages, presence and blocks.
  await db.query(
    `INSERT INTO "${SCHEMA}"."friendship" ("requesterId", "addresseeId", "status", "respondedAt")
     VALUES ($1, $2, 'ACCEPTED', now())`,
    [people.owner.id, people.friend.id],
  );

  const world: DisposableWorld = { run, switchWas, storytimeWas, people };

  writeFileSync(file, JSON.stringify(world, null, 2), { mode: 0o600 });

  return {
    run,
    cleared,
    signInCountsForgotten: await forgetLocalRateCounts(),
    people: Object.fromEntries(
      ROLES.map(role => [role, people[role].username]),
    ),
  };
}

/**
 * Throws the master switch, as an operator would, by writing the setting.
 *
 * @param db - The connection.
 * @param state - On or off.
 * @returns The setting written.
 */
async function setSwitch(db: DataSource, state: string): Promise<Result> {
  return writeSwitch(db, FLEET_SWITCH, state);
}

/**
 * Throws Storytime's switch, for the journey through Storytime Moderation
 * (FC-039). Nothing in the interface throws it. `restore` puts it back as
 * `fleet-begin` found it, which the journeys after need; `fleet-finish` does
 * the same.
 *
 * @param db - The connection.
 * @param state - `on`, `off`, or `restore`.
 * @param file - The file `fleet-begin` wrote, for `restore`.
 * @returns The setting written, or nothing when there is none to restore.
 */
async function setStorytime(
  db: DataSource,
  state: string,
  file?: string,
): Promise<Result> {
  if (state !== 'restore') {
    return writeSwitch(db, STORYTIME_SWITCH, state);
  }

  const was = (JSON.parse(readFileSync(file ?? '', 'utf8')) as DisposableWorld)
    .storytimeWas;

  return was === null || was === undefined
    ? { key: STORYTIME_SWITCH, value: null }
    : writeSwitch(db, STORYTIME_SWITCH, was === 'true' ? 'on' : 'off');
}

/**
 * Reads a switch.
 *
 * @param db - The connection.
 * @param key - The setting.
 * @returns Its value, or null when there is none.
 */
async function settingOf(db: DataSource, key: string): Promise<string | null> {
  const [setting] = (await db.query(
    `SELECT "value" FROM "${SCHEMA}"."app_setting" WHERE "key" = $1`,
    [key],
  )) as Array<{ value: string }>;

  return setting?.value ?? null;
}

/**
 * Writes a switch, as an operator would. The server reads it within ten
 * seconds.
 *
 * @param db - The connection.
 * @param key - The setting.
 * @param state - On or off.
 * @returns The setting written.
 */
async function writeSwitch(
  db: DataSource,
  key: string,
  state: string,
): Promise<Result> {
  const value = state === 'on' ? 'true' : 'false';

  await db.query(
    `UPDATE "${SCHEMA}"."app_setting" SET "value" = $2, "updatedAt" = now() WHERE "key" = $1`,
    [key, value],
  );

  return { key, value };
}

/**
 * Ends a run: removes everything, and puts the switches back.
 *
 * @param db - The connection.
 * @param file - The file `fleet-begin` wrote.
 * @returns What was removed.
 */
async function finish(db: DataSource, file: string): Promise<Result> {
  let switchWas: string | null = null;
  let storytimeWas: string | null = null;

  try {
    const world = JSON.parse(readFileSync(file, 'utf8')) as DisposableWorld;

    switchWas = world.switchWas;
    storytimeWas = world.storytimeWas ?? null;
  } catch {
    // No file: leave the switches as they are.
  }

  const removed = await removeEverything(db);

  if (switchWas !== null) {
    await setSwitch(db, switchWas === 'true' ? 'on' : 'off');
  }

  if (storytimeWas !== null) {
    await setStorytime(db, storytimeWas === 'true' ? 'on' : 'off');
  }

  return {
    ...removed,
    switchRestoredTo: switchWas,
    storytimeRestoredTo: storytimeWas,
  };
}

/**
 * Counts what disposable people and their Communities left.
 *
 * @param db - The connection.
 * @returns The counts; all nought after a finish.
 */
async function counts(db: DataSource): Promise<Result> {
  const [row] = (await db.query(
    `SELECT
       (SELECT count(*)::int FROM "${SCHEMA}"."user" WHERE lower("email") LIKE $1) AS "people",
       (SELECT count(*)::int FROM "${SCHEMA}"."fleet_community" c
          JOIN "${SCHEMA}"."user" u ON u."id" = c."ownerUserId"
         WHERE lower(u."email") LIKE $1) AS "communities",
       (SELECT count(*)::int FROM "${SCHEMA}"."user_profile" WHERE "username" LIKE 'Fc044%') AS "profiles"`,
    [`%@${DISPOSABLE_DOMAIN}`],
  )) as Array<Record<string, number>>;

  return row;
}

/**
 * Makes one of a disposable Community's occurrences under way: started half
 * an hour ago, ending in half an hour. The attendance sheet only opens once an
 * occurrence has started, and the journeys cannot wait for one to.
 *
 * By ID, because the command line is split on spaces before it gets here.
 *
 * @param db - The connection.
 * @param occurrenceId - The occurrence.
 * @returns How many it moved: one, or none if it was not a disposable one.
 */
async function startOccurrence(
  db: DataSource,
  occurrenceId: string,
): Promise<Result> {
  if (!/^[0-9a-f-]{36}$/i.test(occurrenceId ?? '')) {
    throw new Error('fleet-start needs the occurrence ID.');
  }

  const [, started] = (await db.query(
    `UPDATE "${SCHEMA}"."scope_event_occurrence" o
        SET "startsAt" = now() - interval '30 minutes',
            "endsAt" = now() + interval '30 minutes',
            "updatedAt" = now()
       FROM "${SCHEMA}"."scope_event" e
       JOIN "${SCHEMA}"."fleet_community" c ON c."id" = e."communityId"
       JOIN "${SCHEMA}"."user" u ON u."id" = c."ownerUserId"
      WHERE o."id" = $1 AND e."id" = o."eventId" AND o."status" = 'SCHEDULED'
        AND lower(u."email") LIKE $2`,
    [occurrenceId, `%@${DISPOSABLE_DOMAIN}`],
  )) as [unknown[], number];

  return { started };
}

/**
 * Pauses or resumes the rescan campaign queue, so a campaign stays open long
 * enough for a journey to pause, resume and cancel it before the worker
 * finishes it. A journey that pauses it resumes it in a `finally`.
 *
 * @param _db - Unused; every command is handed the connection.
 * @param state - `pause` or `resume`.
 * @returns Whether the queue is paused now.
 */
async function rescanQueue(_db: DataSource, state: string): Promise<Result> {
  if (state !== 'pause' && state !== 'resume') {
    throw new Error('fleet-rescan-queue needs pause or resume.');
  }

  // As src/shared/queue/queue.module.ts builds it.
  const queue = new Queue(RESCAN_CAMPAIGN_QUEUE, {
    connection: { url: process.env.REDIS_URL },
    prefix: process.env.QUEUE_PREFIX ?? 'bull:sto-info:',
  });

  try {
    await (state === 'pause' ? queue.pause() : queue.resume());

    return { paused: await queue.isPaused() };
  } finally {
    await queue.close();
  }
}

/**
 * Removes the disposable people's Communities and keeps the people, and
 * forgets this machine's rate limit counts. Each journey file starts with it:
 * an Owner may hold ten Communities, closed ones included, and a run on
 * desktop and phone registers more than that and writes more than the write
 * limit allows one address in fifteen minutes.
 *
 * @param db - The connection.
 * @returns How many Communities went, and how many counts.
 */
async function clearCommunities(db: DataSource): Promise<Result> {
  return {
    communities: await removeCommunities(db, await disposableIds(db), false),
    rateCountsForgotten: await forgetLocalRateCounts('*'),
  };
}

/** What a held notice's last error says, so only those are let go. */
const HELD_NOTICE = 'Held by the end-to-end journeys';

/**
 * One disposable person, by address.
 *
 * @param db - The connection.
 * @param email - Their address.
 * @returns Their ID.
 * @throws Error when the address is nobody's, or not a disposable one.
 */
async function disposablePerson(
  db: DataSource,
  email: string,
): Promise<string> {
  if (!email?.toLowerCase().endsWith(`@${DISPOSABLE_DOMAIN}`)) {
    throw new Error(
      `Only a disposable person's notices are held, not ${email}.`,
    );
  }

  const [person] = (await db.query(
    `SELECT "id" FROM "${SCHEMA}"."user" WHERE lower("email") = lower($1)`,
    [email],
  )) as Array<{ id: string }>;

  if (!person) {
    throw new Error(`Nobody has the address ${email}.`);
  }

  return person.id;
}

/**
 * Holds a disposable person's waiting roster proposal notices from the
 * outbox, or lets them go (FC-029).
 *
 * A notice is written at delivery from its proposal as it then stands, and
 * set aside if the proposal was answered first. The outbox runs every minute
 * and the notice is queued the moment a replay raises the proposal, so a
 * journey cannot answer first by being quick. Holding gives the notice the
 * outbox's last attempt, which it then passes over; letting it go gives it
 * back its attempts, and the next run decides.
 *
 * `hold` prints `{"waiting":true}`, then waits up to `waitSeconds` for a
 * notice to be queued, looking four times a second, so a journey can start it
 * before the import that raises the proposal and lose the race only to a run
 * in that quarter-second. `release` waits up to `waitSeconds` for the outbox
 * to deliver or set aside what it let go, and says which.
 *
 * @param db - The connection.
 * @param email - Whose notices.
 * @param state - `hold` or `release`.
 * @param waitSeconds - How long to wait; 0 by default.
 * @returns How many were held, or how many let go and what became of them.
 */
async function proposalNotices(
  db: DataSource,
  email: string,
  state: string,
  waitSeconds = '0',
): Promise<Result> {
  if (state !== 'hold' && state !== 'release') {
    throw new Error('fleet-proposal-notices needs hold or release.');
  }

  const userId = await disposablePerson(db, email);
  const until = Date.now() + Number(waitSeconds) * 1000;
  const pause = (): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, 250));

  if (state === 'release') {
    const [rows] = (await db.query(
      `UPDATE "${SCHEMA}"."notification_outbox"
          SET "attempts" = 0, "lastError" = NULL
        WHERE "userId" = $1 AND "kind" = 'ROSTER_ASSOCIATION_PROPOSED'
          AND "deliveredAt" IS NULL AND "skippedAt" IS NULL AND "lastError" = $2
      RETURNING "id"`,
      [userId, HELD_NOTICE],
    )) as [Array<{ id: string }>, number];
    const ids = rows.map(row => row.id);

    for (;;) {
      const [settled] = (await db.query(
        `SELECT count(*) FILTER (WHERE "deliveredAt" IS NOT NULL)::int AS "delivered",
                count(*) FILTER (WHERE "skippedAt" IS NOT NULL)::int AS "skipped"
           FROM "${SCHEMA}"."notification_outbox" WHERE "id" = ANY($1::uuid[])`,
        [ids],
      )) as Array<{ delivered: number; skipped: number }>;

      if (
        settled.delivered + settled.skipped === ids.length ||
        Date.now() >= until
      ) {
        return { released: ids.length, ...settled };
      }

      await pause();
    }
  }

  process.stdout.write('{"waiting":true}\n');

  for (;;) {
    const [, held] = (await db.query(
      `UPDATE "${SCHEMA}"."notification_outbox"
          SET "attempts" = $3, "lastError" = $2
        WHERE "userId" = $1 AND "kind" = 'ROSTER_ASSOCIATION_PROPOSED'
          AND "deliveredAt" IS NULL AND "skippedAt" IS NULL AND "attempts" < $3`,
      [userId, HELD_NOTICE, OUTBOX_ATTEMPTS],
    )) as [unknown[], number];

    if (held > 0 || Date.now() >= until) {
      return { held };
    }

    await pause();
  }
}

/**
 * Counts a disposable person's direct message notices, without opening a
 * page of theirs: a page holds chat's socket, and a person with one open is
 * not sent a notice at all (FC-033).
 *
 * @param db - The connection.
 * @param email - Whose notices.
 * @returns `notices`, the "sent you a message" notices they have, and
 *   `pending`, those the outbox has still to decide.
 */
async function directMessageNotices(
  db: DataSource,
  email: string,
): Promise<Result> {
  const userId = await disposablePerson(db, email);
  const [counts] = (await db.query(
    `SELECT
       (SELECT count(*)::int FROM "${SCHEMA}"."notification"
         WHERE "userId" = $1 AND "deletedAt" IS NULL
           AND "title" LIKE '% sent you a message') AS "notices",
       (SELECT count(*)::int FROM "${SCHEMA}"."notification_outbox"
         WHERE "userId" = $1 AND "kind" = 'CHAT_DIRECT_MESSAGE'
           AND "deliveredAt" IS NULL AND "skippedAt" IS NULL) AS "pending"`,
    [userId],
  )) as Array<{ notices: number; pending: number }>;

  return counts;
}

/** The commands, by name. */
const COMMANDS: Record<
  string,
  (db: DataSource, ...args: string[]) => Promise<Result>
> = {
  'fleet-begin': begin,
  'fleet-flag': setSwitch,
  'fleet-finish': finish,
  'fleet-counts': counts,
  'fleet-clear-communities': clearCommunities,
  'fleet-start': startOccurrence,
  'fleet-rescan-queue': rescanQueue,
  'fleet-storytime': setStorytime,
  'fleet-proposal-notices': proposalNotices,
  'fleet-dm-notices': directMessageNotices,
};

/**
 * Brings a disposable person's moderation holds to their review date, then
 * runs the hold review the scheduler runs at 05:03 (FC-037).
 *
 * Only holds still in force, owned by a disposable person and placed with a
 * reason starting `reasonPrefix`, are moved, and only to a minute ago: a
 * week past, the review would tell every site admin rather than the hold's
 * owner. Like the 05:03 run, the review also acts on any other hold due on
 * this machine.
 *
 * @param app - The application.
 * @param db - The connection.
 * @param reasonPrefix - The start of the holds' reason: the journey's tag.
 * @returns How many were moved, and what the review did.
 */
async function reviewHolds(
  app: INestApplicationContext,
  db: DataSource,
  reasonPrefix: string,
): Promise<Result> {
  if (!reasonPrefix) {
    throw new Error('fleet-review-holds needs the start of the holds’ reason.');
  }

  const [, moved] = (await db.query(
    `UPDATE "${SCHEMA}"."moderation_hold"
        SET "reviewAt" = now() - interval '1 minute'
      WHERE "releasedAt" IS NULL AND "ownerUserId" = ANY($1::uuid[])
        AND "reason" LIKE $2 || '%'`,
    [await disposableIds(db), reasonPrefix],
  )) as [unknown[], number];

  return {
    moved,
    review: await app.get(FleetRetentionScheduler).moderationHolds(),
  };
}

/**
 * Brings a held roster export of a disposable Community's Fleet to the end of
 * its file's retention, then runs the roster-source retention the scheduler
 * runs at 04:11 (FC-037). Its file is deleted, and the export, never chosen,
 * is retired as expired. Like the 04:11 run, it also expires any other
 * overdue file on this machine.
 *
 * @param app - The application.
 * @param db - The connection.
 * @param importId - The export, as its page's address names it.
 * @returns How many files were moved, and what the run did.
 */
async function expireExport(
  app: INestApplicationContext,
  db: DataSource,
  importId: string,
): Promise<Result> {
  if (!/^[0-9a-f-]{36}$/i.test(importId ?? '')) {
    throw new Error('fleet-expire-export needs the export’s ID.');
  }

  const [, moved] = (await db.query(
    `UPDATE "${SCHEMA}"."file_asset" a
        SET "retainUntil" = now() - interval '1 minute'
       FROM "${SCHEMA}"."fleet_roster_import_source" s
       JOIN "${SCHEMA}"."sto_fleet" f ON f."id" = s."fleetId"
       JOIN "${SCHEMA}"."fleet_community" c ON c."id" = f."communityId"
      WHERE s."id" = $1 AND a."id" = s."assetId"
        AND c."ownerUserId" = ANY($2::uuid[])
        AND EXISTS (SELECT 1 FROM "${SCHEMA}"."file_asset_placement" p
                     WHERE p."assetId" = a."id" AND p."state" = 'HELD')`,
    [importId, await disposableIds(db)],
  )) as [unknown[], number];

  if (moved !== 1) {
    throw new Error(
      `Export ${importId} is not a held export of a disposable Community's Fleet.`,
    );
  }

  return {
    moved,
    retention: await app.get(FleetRetentionScheduler).rosterSources(),
  };
}

/**
 * The commands that run one of the application's own jobs, so need it
 * started, by name.
 */
const APP_COMMANDS: Record<
  string,
  (
    app: INestApplicationContext,
    db: DataSource,
    ...args: string[]
  ) => Promise<Result>
> = {
  'fleet-review-holds': reviewHolds,
  'fleet-expire-export': expireExport,
};

/**
 * Whether a command needs the application started.
 *
 * @param name - The command.
 * @returns True for one of the application's jobs.
 */
export function isFleetAppCommand(name: string): boolean {
  return name in APP_COMMANDS;
}

/**
 * Runs one of the Fleet commands that need the application, in a context the
 * caller started. Every scheduled job in that context is stopped first: the
 * running server's are the ones that run, and an outbox run in a process
 * with no sockets would take everybody to be away.
 *
 * @param app - The application.
 * @param name - The command.
 * @param args - Its arguments.
 * @returns What it printed for the journeys.
 */
export async function runFleetAppSupport(
  app: INestApplicationContext,
  name: string,
  args: string[],
): Promise<Result> {
  if (!LOCAL_HOSTS.has(process.env.DB_HOST ?? '')) {
    throw new Error(
      `The Fleet journeys' jobs run only against a database on this machine, not on ${process.env.DB_HOST}.`,
    );
  }

  for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
    void job.stop();
  }

  return APP_COMMANDS[name](app, app.get(DataSource), ...args);
}

/**
 * Runs one Fleet support command.
 *
 * @param name - The command.
 * @param args - Its arguments.
 * @returns What it printed for the journeys.
 */
export async function runFleetSupport(
  name: string,
  args: string[],
): Promise<Result> {
  const command = COMMANDS[name];

  if (!command) {
    throw new Error(
      `Unknown command "${name}". Try one of: ${Object.keys(COMMANDS).join(', ')}.`,
    );
  }

  const db = await connect();

  try {
    return await command(db, ...args);
  } finally {
    await db.destroy();
  }
}
