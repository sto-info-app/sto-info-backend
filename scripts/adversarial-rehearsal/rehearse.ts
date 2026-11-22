/**
 * The adversarial rehearsal (FC-043): plan section 11's matrix, against the
 * real backend and the real worker on the operations rehearsal's throwaway
 * stack.
 *
 * Unit specs prove each rule with the database, Redis and the bucket faked.
 * This proves the rules still hold when nothing is faked:
 *
 * - **A1 People and places.** Users for every audience the matrix names — a
 *   stranger, a follower, approved members, an Officer, a Community Admin,
 *   the Owner (the site admin, who owns the fixture Community) and the
 *   Owner of another Community — and a second Community with a Fleet.
 * - **A2 The officer canary.** A roster export whose officer columns carry a
 *   token made for this run is checked, imported and reported on; the token
 *   must then be nowhere — every database (a whole `pg_dumpall`), Redis
 *   (saved uncompressed and searched), every object in every bucket, both
 *   applications' logs, and every answer the API gave.
 * - **A3 Who may call what.** Each audience against the roster, its reports
 *   and their CSV, governance, chat, Scan Diagnostics and erasure; forged
 *   identifiers that put one Community's Fleet under another's path; and a
 *   `Cache-Control: no-store` on every answer.
 * - **A4 What the scanner is handed.** Bytes swapped in the bucket after an
 *   upload are refused, never scanned as cleared; a detection placed where a
 *   roster should be is detected by the real clamd and refused, and the
 *   registry will not rewrite the hash it recorded; an archive declared as
 *   a roster is refused before it is scanned. Nothing is published
 *   unscanned.
 * - **A5 Order never matters.** The same three exports uploaded in all six
 *   orders, one order to a Fleet, and three at once to a seventh, give every
 *   Fleet the same roster and history.
 * - **A6 Racing for the last place.** Four members answer Going to an event
 *   with one place at the same moment: one gets it, three wait in order.
 * - **A7 Nothing comes back.** A member erased stays erased through a
 *   re-import of an export naming them and the replay it causes — no trace
 *   in the database, the bucket or the logs; a chat message and a roster file
 *   past their retention are gone before a restarted backend serves; a purge
 *   owed for a day opens `PURGE_OWED`, and its migration's down refuses
 *   while one is recorded.
 * - **A8 Pictures at the door.** A file that is not a picture is refused;
 *   a picture carrying an archive is stored as pixels only. Last, because it
 *   pauses publication.
 *
 * Run it with `npm run rehearse:adversarial`, which builds and starts the
 * stack with `scripts/operations-rehearsal/run-rehearsal.sh adversarial`.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import bcrypt from 'bcrypt';

import {
  LOCAL_FIXTURE_COMMUNITY_ID,
  LOCAL_FIXTURE_PC_FLEET_ID,
} from '../../src/database/migrations/1794000000000-SeedLocalFleetFixtures';
import { AddPurgeOwedAlert1797600000000 } from '../../src/database/migrations/1797600000000-AddPurgeOwedAlert';
import { ROSTER_OFFICER_HEADER_LINE } from '../../src/fleet/imports/constants/roster-csv.constants';
import {
  coldStart,
  png,
  Rehearsal,
  scenario,
  Upload,
} from '../operations-rehearsal/rehearse';
import {
  Api,
  ApiAnswer,
  bucketClient,
  BUCKETS,
  removeScanRequest,
  secondsSince,
  waitFor,
} from '../operations-rehearsal/stack';

/** The results page's heading. */
const TITLE = 'Adversarial rehearsal results (FC-043)';

/** The fixture export every roster here is made from. */
const BASE_FIXTURE =
  'test/fixtures/fleet-community/Fixture Basic Fleet_20240101-120000.Csv';

/** Why the rehearsal erases somebody, for the site admin log. */
const REASON = 'Adversarial rehearsal (FC-043): verified erasure request.';

/**
 * The officer canary for this run. Assembled at run time, as the canary
 * specs assemble theirs, so the token appears in no source file, and made
 * unique so nothing an earlier run left behind can be mistaken for a leak.
 */
const CANARY = `${['OFFICER', 'CANARY'].join('-')}-${randomBytes(6).toString('hex')}`;

/**
 * Bytes the rehearsal's clamd detects, by a signature
 * `run-rehearsal.sh` gives it for the run, and nothing else knows: EICAR
 * would do the same, but an antivirus on the machine running the rehearsal
 * can intercept EICAR in localhost traffic between MinIO and the worker, and
 * the scan then never sees it. EICAR itself is proved against a real clamd
 * by the worker's scan rehearsal.
 */
const MARKER = Buffer.from(
  `${process.env.REHEARSAL_TEST_SIGNATURE ?? 'no test signature'}\r\n`,
  'ascii',
);

/** The member A7 erases: in the fixture, so in every export made from it. */
const ERASED = { characterName: 'Dax Orlan', accountHandle: '@fixture002' };

/** A name and a public comment from the fixture that stay, for contrast. */
const KEPT = {
  characterName: 'Aria Venn',
  comment: 'Happy to run TFOs at weekends',
};

/** The audiences the matrix is run for. */
type Who =
  | 'anonymous'
  | 'stranger'
  | 'follower'
  | 'member'
  | 'officer'
  | 'communityAdmin'
  | 'owner'
  | 'outsider';

/** One person the rehearsal made, signed in. */
interface Person {
  readonly id: string;
  readonly api: Api;
}

/** Everything the scenarios here share beyond the operations stack's. */
class Adversary {
  /** The people, by audience, and the extra members for A6. */
  readonly people = new Map<Who, Person>();
  readonly extraMembers: Person[] = [];
  /** Every answer the API gave anybody here, for the canary sweep. */
  readonly answers: string[] = [];
  /** Every Cache-Control the API sent, by the request that got it. */
  readonly caching: Array<{ request: string; header: string | null }> = [];
  /** The second Community, its Owner's, and its Fleet. */
  readonly otherCommunityId = randomUUID();
  readonly otherFleetId = randomUUID();
  /** The fixture Fleet's chat channel, once chat has made it. */
  channelId: string | null = null;

  /**
   * Creates an instance of Adversary.
   *
   * @param r - The operations stack's rehearsal.
   */
  constructor(readonly r: Rehearsal) {}

  /**
   * Makes a user who can sign in, in SQL, with a password made for this run.
   *
   * @param label - What they are for, in their username.
   * @returns Them, signed in.
   */
  async person(label: string): Promise<Person> {
    const id = randomUUID();
    const email = `adv-${label.toLowerCase()}-${id.slice(0, 8)}@rehearsal.example`;
    const password = randomBytes(18).toString('hex');

    await this.r.db.query(
      `INSERT INTO "sto_info_app"."user" ("id", "email", "password", "emailVerified", "role")
       VALUES ($1, $2, $3, true, 'USER')`,
      [id, email, await bcrypt.hash(password, 10)],
    );
    await this.r.db.query(
      `INSERT INTO "sto_info_app"."user_profile" ("userId", "username", "firstName", "lastName")
       VALUES ($1, $2, 'Adversarial', 'Rehearsal')`,
      [id, `Adv${label}${id.slice(0, 6)}`],
    );

    const api = new Api(this.r.config.ports.backend);

    await api.signIn(email, password);

    return { id, api };
  }

  /**
   * Calls the API as somebody, keeping the answer for the sweeps.
   *
   * @param who - Who calls.
   * @param method - The method.
   * @param path - The path.
   * @param body - The body, if any.
   * @returns The answer.
   */
  async call<T = unknown>(
    who: Who,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiAnswer<T>> {
    const api =
      who === 'anonymous'
        ? new Api(this.r.config.ports.backend)
        : who === 'owner'
          ? this.r.api
          : this.people.get(who)!.api;
    const answer = await api.call<T>(method, path, body);

    this.caching.push({
      request: `${who} ${method} ${path}`,
      header: api.lastCacheControl,
    });
    this.answers.push(
      typeof answer.body === 'string'
        ? answer.body
        : JSON.stringify(answer.body),
    );

    return answer;
  }
}

/**
 * The fixture export, as lines.
 *
 * @param r - The rehearsal.
 * @returns Its header and rows.
 */
function fixtureLines(r: Rehearsal): string[] {
  return readFileSync(join(r.config.repo, BASE_FIXTURE), 'utf8')
    .split(/\r?\n/)
    .filter(line => line !== '');
}

/**
 * Uploads a roster export to a Fleet as the Owner.
 *
 * @param r - The rehearsal.
 * @param fleetId - The Fleet.
 * @param filename - The export's name.
 * @param bytes - Its bytes.
 * @param communityId - The Fleet's Community.
 * @returns The answer.
 */
async function uploadExport(
  r: Rehearsal,
  fleetId: string,
  filename: string,
  bytes: Buffer,
  communityId = LOCAL_FIXTURE_COMMUNITY_ID,
): Promise<ApiAnswer<{ id?: string; assetId?: string }>> {
  return r.api.upload<{ id?: string; assetId?: string }>(
    `/fleet-communities/${communityId}/fleets/${fleetId}/roster-imports`,
    'roster',
    filename,
    bytes,
    'text/csv',
    { timezone: 'UTC' },
  );
}

/**
 * Turns an accepted upload into an `Upload`, or says why it was not one.
 *
 * @param answer - The upload's answer.
 * @returns The import and its asset.
 * @throws Error when the upload was not accepted.
 */
function accepted(
  answer: ApiAnswer<{ id?: string; assetId?: string }>,
): Upload {
  if (answer.status !== 202 || !answer.body.id || !answer.body.assetId) {
    throw new Error(
      `Upload answered ${answer.status}: ${JSON.stringify(answer.body).slice(0, 300)}`,
    );
  }

  return { importId: answer.body.id, assetId: answer.body.assetId };
}

/**
 * Searches text for the canary.
 *
 * @param text - Where to look.
 * @returns How many times it appears.
 */
function sightings(text: string): number {
  return text.split(CANARY).length - 1;
}

/**
 * Reads every object in every bucket.
 *
 * @param r - The rehearsal.
 * @returns Each object's key and its bytes, as Latin-1 text.
 */
async function everyObject(
  r: Rehearsal,
): Promise<Array<{ key: string; text: string; unread?: boolean }>> {
  const client = bucketClient(r.config);
  const found: Array<{ key: string; text: string; unread?: boolean }> = [];

  for (const bucket of Object.values(BUCKETS)) {
    let token: string | undefined;

    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      );

      for (const object of page.Contents ?? []) {
        try {
          const got = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: object.Key! }),
          );
          const bytes = Buffer.from(await got.Body!.transformToByteArray());

          found.push({
            key: `${bucket}/${object.Key}`,
            text: bytes.toString('latin1'),
          });
        } catch {
          // Counted, so a search that could not read everything says so.
          found.push({
            key: `${bucket}/${object.Key}`,
            text: '',
            unread: true,
          });
        }
      }

      token = page.NextContinuationToken;
    } while (token !== undefined);
  }

  return found;
}

/**
 * Joins what was read from the buckets, refusing to go on if anything could
 * not be read: a search that skipped an object proves nothing about it.
 *
 * @param objects - What everyObject found.
 * @returns Their text, joined.
 * @throws Error naming the objects that could not be read.
 */
function readable(
  objects: ReadonlyArray<{ key: string; text: string; unread?: boolean }>,
): string {
  const unread = objects.filter(object => object.unread);

  if (unread.length > 0) {
    throw new Error(
      `${unread.length} object(s) could not be read: ${unread.map(object => object.key).join(', ')}`,
    );
  }

  return objects.map(object => object.text).join('\n');
}

/**
 * Dumps every database, the worker's schema included, as text.
 *
 * @param r - The rehearsal.
 * @returns The dump.
 */
async function everyDatabase(r: Rehearsal): Promise<string> {
  return r.containers.exec('pg', 'pg_dumpall -U postgres');
}

/**
 * Saves Redis uncompressed and reads the file back.
 *
 * @param r - The rehearsal.
 * @returns The saved data, as Latin-1 text.
 */
async function everyRedisValue(r: Rehearsal): Promise<string> {
  await r.containers.exec('redis', 'redis-cli CONFIG SET rdbcompression no');
  await r.containers.exec('redis', 'redis-cli SAVE');

  return r.containers.exec('redis', 'cat /data/dump.rdb');
}

/**
 * Every log line either application wrote.
 *
 * @param r - The rehearsal.
 * @returns The logs, concatenated.
 */
function everyLog(r: Rehearsal, running = false): string {
  return readdirSync(r.logs)
    .filter(file => !running || !file.includes('migration'))
    .map(file => readFileSync(join(r.logs, file), 'utf8'))
    .join('\n');
}

// ----- A1 -----

/**
 * Makes the people and the second Community.
 *
 * @param a - The adversary.
 */
async function peopleAndPlaces(a: Adversary): Promise<void> {
  const name = 'A1 People and places';
  const { r } = a;
  const started = Date.now();

  for (const who of [
    'stranger',
    'follower',
    'member',
    'officer',
    'communityAdmin',
    'outsider',
  ] as const) {
    a.people.set(who, await a.person(who));
  }

  for (let i = 1; i <= 3; i++) {
    a.extraMembers.push(await a.person(`member${i}`));
  }

  const approve = async (userId: string): Promise<void> => {
    await r.db.query(
      `INSERT INTO "sto_info_app"."scope_membership"
         ("communityId", "fleetId", "userId", "status", "decidedAt", "decidedByUserId")
       VALUES ($1, $2, $3, 'APPROVED', now(), $4)`,
      [
        LOCAL_FIXTURE_COMMUNITY_ID,
        LOCAL_FIXTURE_PC_FLEET_ID,
        userId,
        r.adminId,
      ],
    );
  };

  for (const person of [
    a.people.get('member')!,
    a.people.get('officer')!,
    ...a.extraMembers,
  ]) {
    await approve(person.id);
  }

  await r.db.query(
    `INSERT INTO "sto_info_app"."scope_role_assignment"
       ("communityId", "fleetId", "userId", "role", "grantedByUserId", "reason")
     VALUES ($1, $2, $3, 'OFFICER', $4, $5)`,
    [
      LOCAL_FIXTURE_COMMUNITY_ID,
      LOCAL_FIXTURE_PC_FLEET_ID,
      a.people.get('officer')!.id,
      r.adminId,
      REASON,
    ],
  );
  await r.db.query(
    `INSERT INTO "sto_info_app"."scope_role_assignment"
       ("communityId", "userId", "role", "grantedByUserId", "reason")
     VALUES ($1, $2, 'ADMIN', $3, $4)`,
    [
      LOCAL_FIXTURE_COMMUNITY_ID,
      a.people.get('communityAdmin')!.id,
      r.adminId,
      REASON,
    ],
  );

  const follow = await a.call(
    'follower',
    'POST',
    `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/follow`,
  );

  r.results.check(
    name,
    'A follower follows the fixture Community',
    follow.status >= 200 && follow.status < 300,
    null,
    String(follow.status),
  );

  // Another Community, owned by somebody who is nothing in the first, with
  // a Fleet of the same platform whose name differs.
  await r.db.query(
    `INSERT INTO "sto_info_app"."fleet_community" ("id", "ownerUserId", "name", "slug")
     VALUES ($1, $2, 'Adversarial Other Community', 'adversarial-other-community')`,
    [a.otherCommunityId, a.people.get('outsider')!.id],
  );
  await r.db.query(
    `INSERT INTO "sto_info_app"."sto_fleet"
       ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug")
     SELECT $1, $2, "id", 'Adversarial Other Fleet', 'adversarial other fleet', 'adversarial-other-fleet'
       FROM "sto_info_app"."platform" WHERE "name" = 'Windows' AND "deletedAt" IS NULL`,
    [a.otherFleetId, a.otherCommunityId],
  );

  r.results.record(
    name,
    'Stranger, follower, four members, an Officer, a Community Admin and another Community’s Owner made',
    'PASS',
    secondsSince(started),
  );
}

// ----- A2 -----

/**
 * Makes an officer's export of the fixture Fleet whose officer columns
 * carry the canary.
 *
 * @param r - The rehearsal.
 * @param stamp - The filename stamp, YYYYMMDD.
 * @returns Its name and bytes.
 */
function officerExport(
  r: Rehearsal,
  stamp: string,
): { filename: string; bytes: Buffer } {
  const [, ...rows] = fixtureLines(r);
  const lines = [
    ROSTER_OFFICER_HEADER_LINE,
    ...rows.map(
      (row, i) =>
        `${row},"${CANARY}-comment-${i}",${CANARY}-author-${i},3/3/2023 4:00:00pm`,
    ),
  ];

  return {
    filename: `Fixture Basic Fleet_${stamp}-120000.Csv`,
    bytes: Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'),
  };
}

/**
 * The officer canary, end to end.
 *
 * @param a - The adversary.
 */
async function officerCanary(a: Adversary): Promise<void> {
  const name = 'A2 Officer canary';
  const { r } = a;
  const base = `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/fleets/${LOCAL_FIXTURE_PC_FLEET_ID}`;
  const file = officerExport(r, '20250301');

  r.results.check(
    name,
    'The export carries the canary in its officer columns',
    sightings(file.bytes.toString('utf8')) > 0,
    null,
    `${sightings(file.bytes.toString('utf8'))} cells`,
  );

  const preview = await r.api.upload(
    `${base}/roster-imports/preview`,
    'roster',
    file.filename,
    file.bytes,
    'text/csv',
    { timezone: 'UTC' },
  );

  a.answers.push(JSON.stringify(preview.body));
  r.results.check(
    name,
    'The check reads it, officer notes counted and discarded',
    preview.status === 200 || preview.status === 201,
    null,
    `${preview.status}, officerTailRowCount ${(preview.body as { source?: { officerTailRowCount?: number } }).source?.officerTailRowCount}`,
  );

  // A row whose officer tail is unreadable: refused, and the refusal says
  // nothing of what the row held.
  const broken = Buffer.from(
    `${ROSTER_OFFICER_HEADER_LINE}\r\n` +
      `Kell Marr,@fixture003,65,KDF Engineering Officer,Officer,1,1/9/2022 6:20:00pm,,1/2/2024 8:00:00am,"Offline","",,"${CANARY}-broken,never closed\r\n`,
    'utf8',
  );
  const refused = await r.api.upload(
    `${base}/roster-imports/preview`,
    'roster',
    'Fixture Basic Fleet_20250302-120000.Csv',
    broken,
    'text/csv',
    { timezone: 'UTC' },
  );

  a.answers.push(JSON.stringify(refused.body));
  r.results.check(
    name,
    'An unreadable officer tail is refused',
    refused.status === 400,
    null,
    String(refused.status),
  );

  const upload = accepted(
    await uploadExport(r, LOCAL_FIXTURE_PC_FLEET_ID, file.filename, file.bytes),
  );
  const seconds = await r.imported(upload);

  r.results.record(name, 'Imported and in force', 'PASS', seconds);

  for (const path of [
    `${base}/roster-imports/${upload.importId}`,
    `${base}/roster-imports/${upload.importId}/rows`,
    `${base}/roster`,
    `${base}/roster/history`,
    `${base}/reports`,
    ...['growth', 'activity', 'tenure', 'ranks', 'contribution'].flatMap(
      report => [`${base}/reports/${report}`, `${base}/reports/${report}/csv`],
    ),
  ]) {
    await a.call('owner', 'GET', path);
  }

  // Give the replay the import queued, and any log line it writes, time to
  // land before anything is searched.
  await sleep(15_000);

  // Each place is searched for the canary and for something that must be
  // there, so a search that found nothing because it read nothing fails.
  const count = (text: string, value: string) => text.split(value).length - 1;
  const sweeps: Array<[string, () => Promise<string>, string]> = [
    ['every database (pg_dumpall)', () => everyDatabase(r), KEPT.comment],
    ['Redis, saved uncompressed', () => everyRedisValue(r), 'bull:'],
    [
      'every object in every bucket',
      async () => readable(await everyObject(r)),
      KEPT.characterName,
    ],
    [
      'both applications’ logs',
      async () => everyLog(r),
      'Roster read into observations',
    ],
    ['every API answer', async () => a.answers.join('\n'), KEPT.characterName],
  ];

  for (const [where, read, control] of sweeps) {
    const at = Date.now();
    const text = await read();
    const found = sightings(text);
    const seen = count(text, control);

    r.results.check(
      name,
      `The canary is nowhere in ${where}`,
      found === 0 && seen > 0,
      secondsSince(at),
      `${found} sighting(s); control “${control}” seen ${seen} time(s) in ${text.length} characters`,
    );
  }

  // The contrast: what the officer columns sat beside is kept and shown.
  const roster = await a.call<{
    rows?: Array<{ publicComment?: string | null }>;
  }>('member', 'GET', `${base}/roster`);

  r.results.check(
    name,
    'The public comment beside them reached the roster',
    JSON.stringify(roster.body).includes(KEPT.comment),
    null,
    String(roster.status),
  );
}

// ----- A3 -----

/** What an audience must get from a route. */
type Expected = 'ALLOWED' | 'REFUSED';

/**
 * Who may call what, over HTTP.
 *
 * @param a - The adversary.
 */
async function whoMayCallWhat(a: Adversary): Promise<void> {
  const name = 'A3 Who may call what';
  const { r } = a;
  const fleetA = `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/fleets/${LOCAL_FIXTURE_PC_FLEET_ID}`;
  const fleetB = `/fleet-communities/${a.otherCommunityId}/fleets/${a.otherFleetId}`;

  // Chat makes a Fleet's standard channels when somebody first asks.
  const channels = await a.call<
    Array<{
      target: { fleetId: string | null };
      channels: Array<{ id: string }>;
    }>
  >('member', 'GET', '/chat/channels');
  const list = (Array.isArray(channels.body) ? channels.body : [])
    .filter(scope => scope.target.fleetId === LOCAL_FIXTURE_PC_FLEET_ID)
    .flatMap(scope => scope.channels);

  a.channelId = list[0]?.id ?? null;
  r.results.check(
    name,
    'A member is offered the Fleet’s chat channels',
    channels.status === 200 && a.channelId !== null,
    null,
    `${channels.status}, ${list.length} channel(s)`,
  );

  const everybody: Who[] = [
    'anonymous',
    'stranger',
    'follower',
    'member',
    'officer',
    'communityAdmin',
    'owner',
    'outsider',
  ];
  const insiders = new Set<Who>([
    'member',
    'officer',
    'communityAdmin',
    'owner',
  ]);
  const routes: Array<{
    label: string;
    method: string;
    path: string;
    body?: unknown;
    allowed: (who: Who) => boolean;
    /** Text a refused answer must never carry. */
    secrets?: readonly string[];
  }> = [
    {
      label: 'the private roster',
      method: 'GET',
      path: `${fleetA}/roster`,
      allowed: who => insiders.has(who),
      secrets: [KEPT.characterName, '@fixture001', KEPT.comment],
    },
    {
      label: 'the roster’s history',
      method: 'GET',
      path: `${fleetA}/roster/history`,
      allowed: who => insiders.has(who),
      secrets: [KEPT.characterName, '@fixture001'],
    },
    {
      label: 'the roster imports',
      method: 'GET',
      path: `${fleetA}/roster-imports`,
      // An Officer holds only what is delegated (FC-005); nothing is here.
      allowed: who => ['communityAdmin', 'owner'].includes(who),
    },
    {
      label: 'the ranks report as CSV',
      method: 'GET',
      path: `${fleetA}/reports/ranks/csv`,
      // A report is the Fleet's own to share; whoever may read it, no
      // handle or comment may reach anybody outside the roster's audience.
      allowed: () => true,
    },
    {
      label: 'the Fleet chat channel',
      method: 'GET',
      path: `/chat/channels/${a.channelId}/messages`,
      allowed: who => insiders.has(who),
    },
    {
      // Nobody may give a role to somebody who is not a member; who is
      // refused by the guard, before validation, is what matters here.
      label: 'giving a role',
      method: 'POST',
      path: `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/governance/roles`,
      body: { userId: randomUUID(), role: 'OFFICER', reason: REASON },
      allowed: () => false,
    },
    {
      label: 'Scan Diagnostics',
      method: 'GET',
      path: '/admin/file-scanning/diagnostics',
      allowed: who => who === 'owner',
    },
    {
      label: 'the erasure list',
      method: 'GET',
      path: '/admin/roster-erasures',
      allowed: who => who === 'owner',
    },
  ];
  const wrong: string[] = [];
  const leaked: string[] = [];

  for (const route of routes) {
    for (const who of everybody) {
      const answer = await a.call(who, route.method, route.path, route.body);
      const expected: Expected = route.allowed(who) ? 'ALLOWED' : 'REFUSED';
      const got: Expected =
        answer.status >= 200 && answer.status < 300 ? 'ALLOWED' : 'REFUSED';
      const text = JSON.stringify(answer.body);

      // Those who may give roles reach validation, and are refused there;
      // everybody else must be stopped by a guard, which runs first.
      if (route.label === 'giving a role') {
        const managers = ['owner', 'communityAdmin'].includes(who);

        if (
          managers
            ? answer.status < 400 || answer.status >= 500
            : ![401, 403, 404].includes(answer.status)
        ) {
          wrong.push(`${who} ${route.label}: ${answer.status}`);
        }

        continue;
      }

      if (route.label === 'the ranks report as CSV') {
        if (!insiders.has(who) && got === 'ALLOWED') {
          for (const secret of [
            '@fixture001',
            KEPT.comment,
            KEPT.characterName,
          ]) {
            if (text.includes(secret)) {
              leaked.push(`${who} ${route.label}: ${secret}`);
            }
          }
        }

        continue;
      }

      if (got !== expected) {
        wrong.push(
          `${who} ${route.label}: ${answer.status}, expected ${expected}`,
        );
      }

      if (got === 'REFUSED') {
        for (const secret of route.secrets ?? []) {
          if (text.includes(secret)) {
            leaked.push(`${who} ${route.label}: ${secret}`);
          }
        }
      }
    }
  }

  r.results.check(
    name,
    `${routes.length} routes × ${everybody.length} audiences answer as the policy says`,
    wrong.length === 0,
    null,
    wrong.length === 0 ? 'all as expected' : wrong.join('; '),
  );
  r.results.check(
    name,
    'No refused answer, and no report for an outsider, carries a name, handle or comment',
    leaked.length === 0,
    null,
    leaked.length === 0 ? 'none' : leaked.join('; '),
  );

  // Forged identifiers: one Community's Fleet under another's path, as the
  // other Community's own Owner, and the reverse as the site admin.
  const forged = await Promise.all([
    a.call(
      'outsider',
      'GET',
      `/fleet-communities/${a.otherCommunityId}/fleets/${LOCAL_FIXTURE_PC_FLEET_ID}/roster`,
    ),
    a.call(
      'outsider',
      'GET',
      `/fleet-communities/${a.otherCommunityId}/fleets/${LOCAL_FIXTURE_PC_FLEET_ID}/roster-imports`,
    ),
    a.call('owner', 'GET', `${fleetB}/roster`),
    a.call(
      'owner',
      'GET',
      `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/fleets/${a.otherFleetId}/roster`,
    ),
    a.call(
      'member',
      'GET',
      `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/fleets/${randomUUID()}/roster`,
    ),
  ]);

  r.results.check(
    name,
    'A Fleet named under another Community’s path, or made up, is refused, even to that Community’s Owner and the site admin',
    forged.every(answer => answer.status === 404 || answer.status === 403),
    null,
    forged.map(answer => answer.status).join(', '),
  );

  // Caching: every answer, allowed or refused, says not to keep it.
  for (const path of [
    '/health/live',
    '/fleet-communities',
    `${fleetA}/reports`,
  ]) {
    await a.call('anonymous', 'GET', path);
  }

  const kept = a.caching.filter(
    entry => !(entry.header ?? '').includes('no-store'),
  );

  r.results.check(
    name,
    'Every answer says Cache-Control: no-store',
    kept.length === 0,
    null,
    kept.length === 0
      ? `${a.caching.length} answers`
      : kept.map(entry => `${entry.request}: ${entry.header}`).join('; '),
  );
}

// ----- A4 -----

/**
 * Stops the worker, uploads a roster, and hands the pipeline something else
 * in its place before the worker starts again.
 *
 * The worker is stopped rather than its scanner frozen: a frozen scanner is
 * only noticed at the next health poll, and a scan begun before then waits
 * out its timeout and its lease. A stopped worker leaves the request on the
 * queue, untouched, until it is back.
 *
 * @param a - The adversary.
 * @param stamp - The export's filename stamp.
 * @param swap - What to do to the stored object and its registry row while
 *   the worker is stopped.
 * @returns The upload.
 */
async function handedSomethingElse(
  a: Adversary,
  stamp: string,
  swap: (upload: Upload, objectKey: string) => Promise<void>,
): Promise<Upload> {
  const { r } = a;
  const [header, ...rows] = fixtureLines(r);
  // A figure no other upload has, so each is a new export rather than a
  // repeat of one already imported.
  const [first, ...others] = rows;
  const unique = first.replace(
    ',120500,',
    `,${120500 + Number(stamp.slice(-4))},`,
  );
  const bytes = Buffer.from(
    `${[header, unique, ...others].join('\r\n')}\r\n`,
    'utf8',
  );

  await r.worker!.kill();

  try {
    const upload = accepted(
      await uploadExport(
        r,
        LOCAL_FIXTURE_PC_FLEET_ID,
        `Fixture Basic Fleet_${stamp}-120000.Csv`,
        bytes,
      ),
    );
    const objectKey = await r.db.value<string>(
      `SELECT "objectKey" AS "value" FROM "sto_info_app"."file_asset" WHERE "id" = $1`,
      [upload.assetId],
    );

    await swap(upload, objectKey!);

    return upload;
  } finally {
    const since = Date.now();

    r.startWorker(`a4-${stamp}`);
    await r.workerRunning(since);
  }
}

/**
 * Waits for an asset to be refused, and says why it was.
 *
 * @param a - The adversary.
 * @param assetId - The asset.
 * @returns Its state and rejection code.
 */
async function refusal(
  a: Adversary,
  assetId: string,
): Promise<{ state: string; code: string | null; seconds: number }> {
  const started = Date.now();
  const waited = await waitFor(
    `asset ${assetId} to be judged`,
    async () => {
      const rows = await a.r.db.query<{ state: string; code: string | null }>(
        `SELECT "state"::text AS "state", "rejectionCode" AS "code"
           FROM "sto_info_app"."file_asset" WHERE "id" = $1`,
        [assetId],
      );

      return ['REJECTED', 'AVAILABLE', 'DELETED'].includes(rows[0]?.state)
        ? rows[0]
        : null;
    },
    420_000,
    1_000,
  );

  return { ...waited.value, seconds: secondsSince(started) };
}

/**
 * What the scanner is handed, through the real pipeline.
 *
 * @param a - The adversary.
 */
async function whatTheScannerIsHanded(a: Adversary): Promise<void> {
  const name = 'A4 What the scanner is handed';
  const { r } = a;
  const client = bucketClient(r.config);

  // 1. The bytes in the bucket replaced after the upload was hashed.
  const swapped = await handedSomethingElse(a, '20250401', async (_, key) => {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.quarantine,
        Key: key,
        Body: Buffer.from(
          'Character Name\r\nnot the export that was cleared\r\n',
        ),
      }),
    );
  });
  const swappedVerdict = await refusal(a, swapped.assetId);

  r.results.check(
    name,
    'Bytes swapped in the bucket after the upload are refused, not scanned as cleared',
    swappedVerdict.state === 'REJECTED' &&
      swappedVerdict.code === 'HASH_MISMATCH',
    swappedVerdict.seconds,
    `${swappedVerdict.state} ${swappedVerdict.code}`,
  );

  // 2 and 3: something ingress would never have accepted, put where a
  // roster was, with a registry row that agrees with it and a fresh scan
  // request — the strongest position an attacker could reach.
  const planted = async (
    stamp: string,
    payload: Buffer,
  ): Promise<{ state: string; code: string | null; seconds: number }> => {
    let objectKey = '';
    const upload = await handedSomethingElse(a, stamp, async (u, key) => {
      objectKey = key;
      await removeScanRequest(r.config, u.assetId);
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKETS.quarantine,
          Key: key,
          Body: payload,
        }),
      );

      const rewrite = (): Promise<unknown> =>
        r.db.query(
          `UPDATE "sto_info_app"."file_asset"
              SET "sha256" = $2, "byteSize" = $3, "state" = 'QUARANTINED',
                  "updatedAt" = now() - interval '3 minutes'
            WHERE "id" = $1`,
          [
            u.assetId,
            createHash('sha256').update(payload).digest('hex'),
            payload.length,
          ],
        );
      // The registry will not let a recorded hash be rewritten; it takes
      // lifting its guard, which only the database's owner can, to plant
      // something with a hash that agrees.
      const refused = await rewrite().then(
        () => null,
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );

      writeOnce.push(refused);
      await r.db.query(
        `ALTER TABLE "sto_info_app"."file_asset" DISABLE TRIGGER "TR_file_asset_guard"`,
      );

      try {
        await rewrite();
      } finally {
        await r.db.query(
          `ALTER TABLE "sto_info_app"."file_asset" ENABLE TRIGGER "TR_file_asset_guard"`,
        );
      }

      // The backend's re-queue sweep, once a minute, asks again for an
      // upload with no request: with the registry's new hash.
      await waitFor(
        `the re-queue sweep to ask again for ${u.assetId}`,
        async () =>
          r.backend!.log().includes('[requeue] Scan requests queued again')
            ? (await r.db.value<string>(
                `SELECT "state"::text AS "value" FROM "sto_info_app"."file_asset" WHERE "id" = $1`,
                [u.assetId],
              )) !== 'QUARANTINED' || null
            : null,
        180_000,
        2_000,
      ).catch(() => undefined);
    });
    const verdict = await refusal(a, upload.assetId);

    // What was planted goes, once judged.
    await client
      .send(
        new DeleteObjectCommand({ Bucket: BUCKETS.quarantine, Key: objectKey }),
      )
      .catch(() => undefined);

    return verdict;
  };
  const writeOnce: Array<string | null> = [];

  const eicar = await planted('20250402', MARKER);

  r.results.check(
    name,
    'The registry refuses to rewrite a recorded hash, even in SQL',
    writeOnce[0]?.includes('sha256 is write-once') ?? false,
    null,
    writeOnce[0] ?? 'it allowed the rewrite',
  );

  r.results.check(
    name,
    'A detection where a roster was is found by the real clamd and refused',
    eicar.state === 'REJECTED' && eicar.code === 'INFECTED',
    eicar.seconds,
    `${eicar.state} ${eicar.code}`,
  );

  // An archive is not text, so a "roster" that is one is refused before
  // any scanner is asked.
  const archive = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    randomBytes(256),
  ]);
  const zipped = await planted('20250403', archive);

  r.results.check(
    name,
    'An archive declared as a roster is refused as not what it says',
    zipped.state === 'REJECTED' && zipped.code === 'CONTENT_TYPE_MISMATCH',
    zipped.seconds,
    `${zipped.state} ${zipped.code}`,
  );

  await r.checkNothingUnscanned(name);
}

// ----- A5 -----

/** The three exports A5 uploads in every order. */
interface OrderedExport {
  readonly stamp: string;
  readonly rows: () => string[];
}

/**
 * Same exports, every order.
 *
 * @param a - The adversary.
 */
async function orderNeverMatters(a: Adversary): Promise<void> {
  const name = 'A5 Order never matters';
  const { r } = a;
  const [header, aria, dax, ...rest] = fixtureLines(r);
  const exports: OrderedExport[] = [
    // Two members.
    { stamp: '20240201', rows: () => [aria, dax] },
    // Aria's contribution rises; Dax leaves; a new member joins.
    {
      stamp: '20240215',
      rows: () => [aria.replace(',120500,', ',131000,'), ...rest.slice(0, 1)],
    },
    // Dax back, Aria's total lower (a reset), rank relabelled.
    {
      stamp: '20240301',
      rows: () => [
        aria.replace(',120500,', ',2000,').replace(',Member,', ',Crew,'),
        dax,
        ...rest.slice(0, 1),
      ],
    },
  ];
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const fleets: Array<{ id: string; label: string; order: number[] | null }> = [
    ...orders,
    null,
  ].map((order, i) => ({
    id: randomUUID(),
    label: `Fixture Order Fleet ${i + 1}`,
    order,
  }));

  for (const fleet of fleets) {
    await r.db.query(
      `INSERT INTO "sto_info_app"."sto_fleet"
         ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug")
       SELECT $1, $2, "id", $3, $4, $5
         FROM "sto_info_app"."platform" WHERE "name" = 'Windows' AND "deletedAt" IS NULL`,
      [
        fleet.id,
        LOCAL_FIXTURE_COMMUNITY_ID,
        fleet.label,
        fleet.label.toLowerCase(),
        fleet.label.toLowerCase().replace(/ /g, '-'),
      ],
    );
  }

  const bytesOf = (index: number): Buffer =>
    Buffer.from(
      `${[header, ...exports[index].rows()].join('\r\n')}\r\n`,
      'utf8',
    );
  const filenameOf = (fleetLabel: string, index: number): string =>
    `${fleetLabel}_${exports[index].stamp}-120000.Csv`;
  const started = Date.now();
  const uploads: Upload[] = [];

  for (const fleet of fleets) {
    if (fleet.order !== null) {
      for (const index of fleet.order) {
        const upload = accepted(
          await uploadExport(
            r,
            fleet.id,
            filenameOf(fleet.label, index),
            bytesOf(index),
          ),
        );

        uploads.push(upload);
        // Each in force before the next, so the order is the order.
        await r.imported(upload, 300_000);
      }
    } else {
      // The seventh: all three at once.
      const answers = await Promise.all(
        [0, 1, 2].map(index =>
          uploadExport(
            r,
            fleet.id,
            filenameOf(fleet.label, index),
            bytesOf(index),
          ),
        ),
      );

      for (const answer of answers) {
        uploads.push(accepted(answer));
      }
    }
  }

  for (const upload of uploads) {
    await r.imported(upload, 300_000);
  }

  r.results.record(
    name,
    `${uploads.length} exports imported into ${fleets.length} Fleets`,
    'PASS',
    secondsSince(started),
  );

  // What each Fleet ends up holding, without anything that is only this
  // Fleet's: identifiers, revisions and when things were computed.
  const normalised = async (fleetId: string): Promise<string> => {
    const settled = await waitFor(
      `the roster of ${fleetId} to cover all three exports`,
      async () => {
        const roster = await r.api.call<Record<string, unknown>>(
          'GET',
          `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/fleets/${fleetId}/roster`,
        );
        const history = await r.api.call<Record<string, unknown>>(
          'GET',
          `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/fleets/${fleetId}/roster/history`,
        );
        const text = JSON.stringify([roster.body, history.body]);

        return roster.status === 200 &&
          exports.every(e =>
            text.includes(
              `${e.stamp.slice(0, 4)}-${e.stamp.slice(4, 6)}-${e.stamp.slice(6, 8)}`,
            ),
          ) &&
          !text.includes('"stale":true')
          ? [roster.body, history.body]
          : null;
      },
      300_000,
      2_000,
    );

    return JSON.stringify(settled.value, (key, value: unknown) =>
      /(^id$|Id$|^revision$|At$|^importId$|^publishedAt$|^generatedAt$|^computedAt$)/.test(
        key,
      ) && key !== 'exportedAt'
        ? undefined
        : value,
    );
  };

  const results: string[] = [];

  for (const fleet of fleets) {
    results.push(await normalised(fleet.id));
  }

  const distinct = new Set(results);
  // The control: what is compared holds the history itself — the members,
  // the relabelled rank and a reset — not an empty shell that would match
  // whatever happened.
  const substance = [
    KEPT.characterName,
    'Crew',
    '"contributionReset":1',
  ].filter(expected => !results[0].includes(expected));

  r.results.check(
    name,
    'All six orders, and all three at once, give every Fleet the same roster and history',
    distinct.size === 1 && substance.length === 0,
    null,
    distinct.size === 1
      ? `${results[0].length} characters each` +
          (substance.length === 0 ? '' : `; missing ${substance.join(', ')}`)
      : `${distinct.size} different results`,
  );
}

// ----- A6 -----

/**
 * Four members race for one place.
 *
 * @param a - The adversary.
 */
async function racingForTheLastPlace(a: Adversary): Promise<void> {
  const name = 'A6 Racing for the last place';
  const { r } = a;
  const events = `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/fleets/${LOCAL_FIXTURE_PC_FLEET_ID}/events`;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const created = await r.api.call<{
    id?: string;
    upcoming?: Array<{ id?: string }>;
  }>('POST', events, {
    title: 'Adversarial rehearsal: one seat',
    audience: 'MEMBERS',
    timezone: 'UTC',
    recurrence: 'NONE',
    startDate: tomorrow,
    startTime: '20:00',
    durationMinutes: 60,
    capacity: 1,
  });
  const eventId = created.body.id;
  const occurrenceId =
    created.body.upcoming?.[0]?.id ??
    (await r.db.value<string>(
      `SELECT "id" AS "value" FROM "sto_info_app"."scope_event_occurrence"
        WHERE "eventId" = $1 ORDER BY "startsAt" LIMIT 1`,
      [eventId],
    ));

  if (
    !r.results.check(
      name,
      'An event with one place is made',
      (created.status === 201 || created.status === 200) &&
        !!eventId &&
        !!occurrenceId,
      null,
      `${created.status}`,
    )
  ) {
    return;
  }

  const racers = [a.people.get('member')!, ...a.extraMembers];
  const answers = await Promise.all(
    racers.map(person =>
      person.api.call<{ response?: string; waitlistPosition?: number | null }>(
        'PUT',
        `${events}/${eventId}/occurrences/${occurrenceId}/rsvp`,
        { response: 'GOING' },
      ),
    ),
  );
  const rows = await r.db.query(
    `SELECT 1 FROM "sto_info_app"."scope_event_rsvp" WHERE "occurrenceId" = $1`,
    [occurrenceId],
  );
  const positions = answers
    .map(answer => answer.body.waitlistPosition ?? null)
    .filter((position): position is number => position !== null)
    .sort();

  r.results.check(
    name,
    'One of four simultaneous answers gets the place; three wait, in order',
    answers.every(answer => answer.status === 200) &&
      positions.join(',') === '1,2,3',
    null,
    `${answers.map(answer => answer.status).join(', ')}; waitlist ${positions.join(',')}; ${rows.length} rows`,
  );
}

// ----- A7 -----

/**
 * Nothing comes back: erasure, retention and owed purges.
 *
 * @param a - The adversary.
 */
async function nothingComesBack(a: Adversary): Promise<void> {
  const name = 'A7 Nothing comes back';
  const { r } = a;
  const base = `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/fleets/${LOCAL_FIXTURE_PC_FLEET_ID}`;
  const traces = async (): Promise<Record<string, number>> => {
    const dump = await everyDatabase(r);
    const objects = await everyObject(r);
    const count = (text: string, value: string) => text.split(value).length - 1;

    readable(objects);

    return {
      database:
        count(dump, ERASED.characterName) + count(dump, ERASED.accountHandle),
      bucket: objects.reduce(
        (sum, o) =>
          sum +
          count(o.text, ERASED.characterName) +
          count(o.text, ERASED.accountHandle),
        0,
      ),
    };
  };

  const before = await traces();

  // The control: before the erasure the same searches find them.
  r.results.check(
    name,
    'Before the erasure, the same searches find the member in the database and the bucket',
    before.database > 0 && before.bucket > 0,
    null,
    `database ${before.database}, bucket ${before.bucket}`,
  );

  const erasure = await r.api.call('POST', '/admin/roster-erasures', {
    ...ERASED,
    reason: REASON,
  });

  r.results.check(
    name,
    'The member is erased',
    erasure.status >= 200 && erasure.status < 300,
    null,
    String(erasure.status),
  );

  await sleep(20_000);

  const after = await traces();

  r.results.check(
    name,
    'No trace of them in any database or bucket once erased',
    after.database === 0 && after.bucket === 0,
    null,
    `database ${after.database}, bucket ${after.bucket}`,
  );

  // An export naming them, sent again: scrubbed at the door, and the replay
  // it causes reads only scrubbed rows.
  const upload = await r.uploadRoster();
  const seconds = await r.imported(upload);

  await sleep(20_000);

  const reimported = await traces();
  const roster = await r.api.call('GET', `${base}/roster`);

  r.results.check(
    name,
    'An export naming them, imported again, brings nothing of them back',
    reimported.database === 0 &&
      reimported.bucket === 0 &&
      !JSON.stringify(roster.body).includes(ERASED.characterName),
    seconds,
    `database ${reimported.database}, bucket ${reimported.bucket}`,
  );

  // What the applications logged while serving; the migration runs' query
  // log quotes the local fixtures' seed data, which names them.
  const logs = everyLog(r, true);
  const logged =
    logs.split(ERASED.characterName).length -
    1 +
    logs.split(ERASED.accountHandle).length -
    1;

  r.results.check(
    name,
    'Neither application ever logged their name or handle',
    logged === 0,
    null,
    `${logged} line(s)`,
  );

  // Retention, caught up at boot: a message and a roster file past their
  // time, as a restore from an older backup would bring them back.
  const post = await a.call<{ id?: string }>(
    'member',
    'POST',
    `/chat/channels/${a.channelId}/messages`,
    {
      body: 'Adversarial rehearsal: an old message',
      clientMessageId: randomUUID(),
    },
  );
  const messageId =
    post.body.id ??
    (await r.db.value<string>(
      `SELECT "id" AS "value" FROM "sto_info_app"."chat_message"
        ORDER BY "createdAt" DESC LIMIT 1`,
    ));

  await r.db.query(
    `UPDATE "sto_info_app"."chat_message" SET "createdAt" = now() - interval '50 days' WHERE "id" = $1`,
    [messageId],
  );
  await r.db.query(
    `UPDATE "sto_info_app"."file_asset" SET "retainUntil" = now() - interval '1 day' WHERE "id" = $1`,
    [upload.assetId],
  );

  await r.backend!.kill();

  const restarted = Date.now();

  r.startBackend('retention-catch-up');
  await r.backendReady();

  const message = await r.db.value<number>(
    `SELECT count(*)::int AS "value" FROM "sto_info_app"."chat_message" WHERE "id" = $1`,
    [messageId],
  );
  const source = await r.db.value<string>(
    `SELECT "state"::text AS "value" FROM "sto_info_app"."file_asset" WHERE "id" = $1`,
    [upload.assetId],
  );
  const summary =
    /Restore check finished - .*Forgotten: ([^\n]*)/.exec(
      r.backend!.log(),
    )?.[1] ?? '';

  r.results.check(
    name,
    'A message and a roster file past retention are gone before the restarted backend serves',
    message === 0 && source === 'DELETED',
    secondsSince(restarted),
    `message rows ${message}, roster file ${source}; ${summary.trim()}`,
  );

  // A purge owed for a day: the alert opens within an alert tick or two.
  await r.db.query(
    `UPDATE "sto_info_app"."file_asset"
        SET "purgeRequiredAt" = now() - interval '25 hours', "purgedAt" = NULL
      WHERE "id" = $1`,
    [upload.assetId],
  );

  const opened = await r.alertOpens('PURGE_OWED');
  const diagnostics = await r.api.call<{ owedPurges?: { overdue?: number } }>(
    'GET',
    '/admin/file-scanning/diagnostics',
  );

  r.results.check(
    name,
    'A purge owed for a day opens PURGE_OWED, and Scan Diagnostics counts it',
    diagnostics.body.owedPurges?.overdue === 1,
    opened.seconds,
    JSON.stringify(diagnostics.body.owedPurges ?? null),
  );

  await r.db.query(
    `UPDATE "sto_info_app"."file_asset" SET "purgeRequiredAt" = NULL WHERE "id" = $1`,
    [upload.assetId],
  );

  // The alert's migration on PostgreSQL 18: its down refuses while an
  // alert of the kind is recorded, and goes cleanly once none is; both
  // inside transactions that are rolled back.
  const outcomes: string[] = [];

  for (const clear of [false, true]) {
    await r.db.inRolledBackTransaction(async runner => {
      if (clear) {
        await runner.query(
          `DELETE FROM "sto_info_app"."operations_alert" WHERE "kind" = 'PURGE_OWED'`,
        );
      }

      try {
        await new AddPurgeOwedAlert1797600000000().down(runner);
        outcomes.push('reverted');
      } catch (error: unknown) {
        outcomes.push(
          (error instanceof Error ? error.message : String(error)).includes(
            'cannot be rolled back',
          )
            ? 'refused'
            : `failed: ${String(error)}`,
        );
      }
    });
  }

  r.results.check(
    name,
    'PURGE_OWED’s migration refuses to come down while such an alert is recorded, and comes down cleanly once none is',
    outcomes.join(', ') === 'refused, reverted',
    null,
    outcomes.join(', '),
  );
}

// ----- A8 -----

/**
 * Pictures at the door, last of all: they need publication paused, since a
 * picture publishes to Cloudflare Images, which this stack cannot reach, and
 * nothing after this must wait on that pause.
 *
 * @param a - The adversary.
 */
async function picturesAtTheDoor(a: Adversary): Promise<void> {
  const name = 'A8 Pictures at the door';
  const { r } = a;
  const client = bucketClient(r.config);

  // A picture that is not one, and one carrying an archive.
  // Publication is paused first: a picture publishes to Cloudflare Images,
  // which this stack cannot reach, and a held picture shows what was
  // stored just as well.
  await r.publication('pause');

  const notAPicture = await r.api.upload(
    '/user/update-profile-pic',
    'profilePicture',
    'marker.png',
    MARKER,
    'image/png',
  );

  r.results.check(
    name,
    'A file that is not a picture, sent as a profile picture, is refused at the door',
    notAPicture.status === 400,
    null,
    String(notAPicture.status),
  );

  const polyglot = Buffer.concat([
    png(10, 20, 30),
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    MARKER,
  ]);
  const before = await r.db.value<number>(
    `SELECT count(*)::int AS "value" FROM "sto_info_app"."file_asset"`,
  );
  const carried = await r.api.upload(
    '/user/update-profile-pic',
    'profilePicture',
    'carrying.png',
    polyglot,
    'image/png',
  );
  const stored = await r.db.query<{ objectKey: string }>(
    `SELECT "objectKey" FROM "sto_info_app"."file_asset"
      ORDER BY "createdAt" DESC LIMIT 1`,
  );
  let storedText = '';

  if (carried.status === 202 && stored[0]?.objectKey) {
    const got = await client.send(
      new GetObjectCommand({
        Bucket: BUCKETS.quarantine,
        Key: stored[0].objectKey,
      }),
    );

    storedText = Buffer.from(await got.Body!.transformToByteArray()).toString(
      'latin1',
    );
  }

  r.results.check(
    name,
    'A picture carrying an archive is stored as pixels only',
    carried.status === 202 &&
      (await r.db.value<number>(
        `SELECT count(*)::int AS "value" FROM "sto_info_app"."file_asset"`,
      ))! > before! &&
      !storedText.includes('FC043-ADVERSARIAL') &&
      !storedText.includes('PK'),
    null,
    `${carried.status}; stored ${storedText.length} bytes`,
  );

  await r.checkNothingUnscanned(name);
}

/** Runs everything. */
async function main(): Promise<void> {
  const r = new Rehearsal(TITLE);
  const a = new Adversary(r);
  const started = new Date();

  await r.egress.listen(r.config.ports.egress);

  try {
    try {
      await coldStart(r);
    } catch (error: unknown) {
      r.results.record(
        'S1 Cold start',
        'Scenario stopped early',
        'FAIL',
        null,
        error instanceof Error ? error.message : String(error),
      );

      throw error;
    }

    await scenario(r, 'A1 People and places', () => peopleAndPlaces(a));
    await scenario(r, 'A2 Officer canary', () => officerCanary(a));
    await scenario(r, 'A3 Who may call what', () => whoMayCallWhat(a));
    await scenario(r, 'A4 What the scanner is handed', () =>
      whatTheScannerIsHanded(a),
    );
    await scenario(r, 'A5 Order never matters', () => orderNeverMatters(a));
    await scenario(r, 'A6 Racing for the last place', () =>
      racingForTheLastPlace(a),
    );
    await scenario(r, 'A7 Nothing comes back', () => nothingComesBack(a));
    await scenario(r, 'A8 Pictures at the door', () => picturesAtTheDoor(a));

    const attempts = r.egress.attemptsSince();
    const counted = new Map<string, number>();

    for (const target of attempts) {
      counted.set(target, (counted.get(target) ?? 0) + 1);
    }

    r.results.check(
      'All',
      'Nothing tried to reach Cloudflare; every other call out was refused',
      attempts.filter(target => target.includes('cloudflare')).length === 0,
      null,
      attempts.length === 0
        ? 'none'
        : [...counted]
            .map(([target, count]) => `${target} x${count}`)
            .join(', '),
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
      `- Backend: ${r.config.repo}; worker: ${r.config.workerRepo} (working trees as built).`,
      '- The operations rehearsal’s stack and cold start (S1), then FC-043’s scenarios A1 to A8.',
      `- The officer canary was made for this run and is not recorded here.`,
      `- Application logs: ${logsCopy}`,
    ]);
    console.log(`\nResults written to ${r.config.results}`);
  }

  if (r.results.failures > 0) {
    throw new Error(`${r.results.failures} check(s) failed`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
