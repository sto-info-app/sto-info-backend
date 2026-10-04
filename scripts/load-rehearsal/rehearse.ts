/**
 * The load rehearsal (FC-044): the launch load Steve agreed on 2 October 2026,
 * against the real backend and the real worker on the operations rehearsal's
 * throwaway stack.
 *
 * The plan never set a launch load, so these are the figures he chose. Each
 * scenario drives one workload at that load while a sampler records, every
 * two seconds, both applications' memory, clamd's, the database connections
 * each application holds, Redis's clients and memory, and how many jobs wait:
 *
 * - **L1 Launch scale.** 100 Communities and 300 Fleets, with 30,000 roster
 *   members between them, each Fleet's roster imported through the real
 *   pipeline — upload, quarantine, scan, import, replay.
 * - **L2 Reads.** 50 requests a second for a minute, spread over the pages a
 *   Community's members read most: the directory, a Community, a Fleet, its
 *   roster, its history and its ranks report. p95 under 500 ms, and nothing
 *   refused.
 * - **L3 A large export checked.** The import check on a 2,000-row export,
 *   the most the parser accepts, under 2 seconds.
 * - **L4 A long history replayed.** A Fleet with 300 exports of 500 rows; one
 *   early export set aside replays the whole history, in under a minute.
 * - **L5 Imports arriving.** 60 imports at once, an hour's worth at launch,
 *   drained well inside the hour.
 * - **L6 Pictures scanned.** 300 profile pictures at once, an hour's worth,
 *   scanned well inside the hour; the worker and clamd inside 2 GB.
 * - **L7 Chat.** 200 sockets in ten Fleets, 20 messages a second for a
 *   minute: acknowledgement and delivery p95 under 500 ms, nothing lost or
 *   doubled.
 *
 * And through all of it, the backend under 512 MiB, and the database and
 * Redis connections inside `docs/operations/render-services.md`'s budgets.
 *
 * People are made in SQL and act with access tokens signed with this run's
 * own secret: 400 sign-ins would meet the sign-in limit long before the
 * load. Each simulated person also arrives with an address of their own, as
 * Cloudflare forwards it, carrying the origin secret the backend checks; from
 * one address the write limit would refuse the seeding long before the load
 * began. Render's own figures are FC-052's.
 *
 * Run it with `npm run rehearse:load`, which builds and starts the stack with
 * `scripts/operations-rehearsal/run-rehearsal.sh load`.
 */
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import bcrypt from 'bcrypt';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { io, Socket } from 'socket.io-client';

import {
  coldStart,
  png,
  Rehearsal,
  scenario,
  Upload,
} from '../operations-rehearsal/rehearse';
import {
  ApiAnswer,
  originHeaders,
  QUEUE_PREFIX,
  secondsSince,
  sqlState,
  StopWaiting,
  waitFor,
} from '../operations-rehearsal/stack';

const run = promisify(execFile);

/** The results page's heading. */
const TITLE = 'Load rehearsal results (FC-044)';

/** The launch load Steve agreed on 2 October 2026. */
const LAUNCH = {
  communities: 100,
  fleetsPerCommunity: 3,
  membersPerFleet: 100,
  readsPerSecond: 50,
  readSeconds: 60,
  previewRows: 2_000,
  replayExports: 300,
  replayRows: 500,
  importsPerHour: 60,
  scansPerHour: 300,
  chatFleets: 10,
  socketsPerFleet: 20,
  postersPerFleet: 4,
  messagesPerSecond: 20,
  chatSeconds: 60,
} as const;

/** What the load must stay inside. */
const BUDGET = {
  readP95Ms: 500,
  previewMs: 2_000,
  replaySeconds: 60,
  chatP95Ms: 500,
  backendMiB: 512,
  workerAndScannerMiB: 2_048,
  // render-services.md: at most 10 per application's DataSource.
  connectionsPerApplication: 10,
  // render-services.md: the Starter plan allows 250, and a deploy holds a
  // backend's and a worker's connections twice over.
  redisPlanClients: 250,
} as const;

/** Why the rehearsal sets an export aside, for the investigation log. */
const REASON = 'Load rehearsal (FC-044): replaying a long history.';

/** The fixture export every roster here is made from. */
const BASE_FIXTURE =
  'test/fixtures/fleet-community/Fixture Basic Fleet_20240101-120000.Csv';

const SCHEMA = 'sto_info_app';

/** One person the rehearsal made. */
interface Person {
  readonly id: string;
  readonly email: string;
  readonly token: string;
  /** The address they appear to call from. */
  readonly address: string;
}

/** A Community the rehearsal made, and its Fleets. */
interface Place {
  readonly communityId: string;
  readonly owner: Person;
  readonly fleets: Array<{ id: string; name: string }>;
}

// ----- Measuring -----

/** The highest of everything sampled while a scenario ran. */
interface Peaks {
  backendMiB: number;
  workerMiB: number;
  scannerMiB: number;
  backendConnections: number;
  workerConnections: number;
  redisClients: number;
  /** Who held them at the peak, by connection name. */
  redisNames: string;
  redisMiB: number;
  waitingJobs: number;
}

/**
 * Reads a process's resident memory.
 *
 * @param pid - The process.
 * @returns Its memory in MiB, or 0 when it cannot be read.
 */
async function residentMiB(pid: number | undefined): Promise<number> {
  if (pid === undefined) {
    return 0;
  }

  try {
    if (process.platform === 'win32') {
      // "node.exe","1234","Console","1","123,456 K"
      const { stdout } = await run('tasklist', [
        '/FI',
        `PID eq ${pid}`,
        '/FO',
        'CSV',
        '/NH',
      ]);
      const kib = Number(
        (stdout.split('","')[4] ?? '').replace(/[^0-9]/g, '') || 0,
      );

      return kib / 1024;
    }

    const { stdout } = await run('ps', ['-o', 'rss=', '-p', String(pid)]);

    return Number(stdout.trim()) / 1024;
  } catch {
    return 0;
  }
}

/**
 * Reads a container's memory, as Docker reports it.
 *
 * @param container - The container.
 * @returns Its memory in MiB, or 0 when it cannot be read.
 */
async function containerMiB(container: string): Promise<number> {
  try {
    const { stdout } = await run('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{.MemUsage}}',
      container,
    ]);
    // "1.012GiB / 15.5GiB"
    const [used] = stdout.trim().split(' / ');
    const value = Number.parseFloat(used);

    if (used.endsWith('GiB')) {
      return value * 1024;
    }

    if (used.endsWith('KiB')) {
      return value / 1024;
    }

    return value;
  } catch {
    return 0;
  }
}

/** Samples the stack every two seconds while a scenario runs. */
class Sampler {
  private _peaks: Peaks = Sampler.empty();
  private _timer: NodeJS.Timeout | null = null;
  private _scannerTimer: NodeJS.Timeout | null = null;
  private _busy = false;
  private readonly _redis: Redis;

  /**
   * Creates an instance of Sampler.
   *
   * @param _r - The rehearsal.
   */
  constructor(private readonly _r: Rehearsal) {
    this._redis = new Redis(`redis://127.0.0.1:${_r.config.ports.redis}`, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    // A dropped connection is a sample missed, not the end of the run.
    this._redis.on('error', () => undefined);
  }

  /**
   * Nothing measured yet.
   *
   * @returns Every peak at nought.
   */
  private static empty(): Peaks {
    return {
      backendMiB: 0,
      workerMiB: 0,
      scannerMiB: 0,
      backendConnections: 0,
      workerConnections: 0,
      redisClients: 0,
      redisNames: '',
      redisMiB: 0,
      waitingJobs: 0,
    };
  }

  /** Starts sampling, forgetting any earlier peaks. */
  start(): void {
    this._peaks = Sampler.empty();
    this._timer = setInterval(() => void this.sample(), 2_000);
    // docker stats takes about a second, so clamd is read less often.
    this._scannerTimer = setInterval(() => void this.sampleScanner(), 10_000);
    void this.sample();
    void this.sampleScanner();
  }

  /**
   * Stops sampling.
   *
   * @returns The peaks seen since it started.
   */
  async stop(): Promise<Peaks> {
    if (this._timer !== null) {
      clearInterval(this._timer);
    }

    if (this._scannerTimer !== null) {
      clearInterval(this._scannerTimer);
    }

    this._timer = null;
    this._scannerTimer = null;
    await this.sample();

    return { ...this._peaks };
  }

  /** Closes its Redis connection. */
  async close(): Promise<void> {
    this._redis.disconnect();
  }

  /**
   * Raises a peak.
   *
   * @param key - Which.
   * @param value - What was seen.
   */
  private raise(key: Exclude<keyof Peaks, 'redisNames'>, value: number): void {
    this._peaks[key] = Math.max(this._peaks[key], value);
  }

  /** Takes one sample of everything but clamd. */
  private async sample(): Promise<void> {
    if (this._busy) {
      return;
    }

    this._busy = true;

    try {
      const { r } = this;

      this.raise('backendMiB', await residentMiB(r.backend?.pid));
      this.raise('workerMiB', await residentMiB(r.worker?.pid));

      const connections = await r.db.query<{ name: string; count: number }>(
        `SELECT "application_name" AS "name", count(*)::int AS "count"
           FROM pg_stat_activity WHERE "datname" = current_database()
          GROUP BY 1`,
      );

      for (const row of connections) {
        if (row.name === 'sto-info-backend') {
          this.raise('backendConnections', row.count);
        }

        if (row.name === 'sto-info-worker') {
          this.raise('workerConnections', row.count);
        }
      }

      if (this._redis.status === 'wait') {
        await this._redis.connect();
      }

      const list = String(await this._redis.client('LIST'))
        .trim()
        .split('\n');
      const memory = String(await this._redis.info('memory'));
      const used = Number(/used_memory:(\d+)/.exec(memory)?.[1] ?? 0);
      // Less this sampler's own connection.
      const clients = list.length - 1;

      if (clients > this._peaks.redisClients) {
        const names = new Map<string, number>();

        for (const line of list) {
          const named = /(?:^| )name=(\S*)/.exec(line)?.[1] || 'unnamed';

          names.set(named, (names.get(named) ?? 0) + 1);
        }

        this._peaks.redisNames = [...names]
          .map(([named, count]) => `${named} ${count}`)
          .join(', ');
      }

      this.raise('redisClients', clients);
      this.raise('redisMiB', used / 1024 / 1024);

      let waiting = 0;

      for (const key of await this._redis.keys(`${QUEUE_PREFIX}*:wait`)) {
        waiting += await this._redis.llen(key);
      }

      for (const key of await this._redis.keys(
        `${QUEUE_PREFIX}*:prioritized`,
      )) {
        waiting += await this._redis.zcard(key);
      }

      this.raise('waitingJobs', waiting);
    } catch {
      // A sample missed is a sample missed; the next one tries again.
    } finally {
      this._busy = false;
    }
  }

  /** Reads clamd's container. */
  private async sampleScanner(): Promise<void> {
    this.raise(
      'scannerMiB',
      await containerMiB(this._r.containers.name('clamd')),
    );
  }

  /** The rehearsal, for the samples. */
  private get r(): Rehearsal {
    return this._r;
  }
}

/**
 * A percentile of some timings.
 *
 * @param values - The timings.
 * @param p - Which, from 0 to 1.
 * @returns It, or 0 when there are none.
 */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

/**
 * Timings as one line.
 *
 * @param values - The timings, in milliseconds.
 * @returns p50, p95, p99 and the maximum.
 */
function spread(values: readonly number[]): string {
  return (
    `p50 ${percentile(values, 0.5).toFixed(0)} ms, ` +
    `p95 ${percentile(values, 0.95).toFixed(0)} ms, ` +
    `p99 ${percentile(values, 0.99).toFixed(0)} ms, ` +
    `max ${Math.max(0, ...values).toFixed(0)} ms (${values.length})`
  );
}

// ----- Calling as somebody -----

/** Requests sent again after a reused connection was reset under them. */
let resent = 0;

/**
 * Calls the API as somebody, from their own address.
 *
 * @param r - The rehearsal.
 * @param who - Who calls, or null for nobody signed in.
 * @param method - The method.
 * @param path - The path.
 * @param body - A JSON body, or form data, if any.
 * @param address - The address to call from, when nobody is signed in.
 * @returns The answer and how long it took.
 */
async function call<T = unknown>(
  r: Rehearsal,
  who: Person | null,
  method: string,
  path: string,
  body?: unknown,
  address = '198.51.100.1',
): Promise<ApiAnswer<T> & { ms: number }> {
  const form = body instanceof FormData;
  const started = performance.now();
  const send = (): Promise<Response> =>
    fetch(`http://127.0.0.1:${r.config.ports.backend}${path}`, {
      method,
      headers: {
        // As Cloudflare forwards it: the proof, and the caller's address.
        ...originHeaders(),
        'CF-Connecting-IP': who?.address ?? address,
        ...(who === null ? {} : { Authorization: `Bearer ${who.token}` }),
        ...(body === undefined || form
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      body:
        body === undefined
          ? undefined
          : form
            ? (body as FormData)
            : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  let response: Response;

  try {
    response = await send();
  } catch (error: unknown) {
    // A kept-alive connection the server closed just as it was reused is
    // reset before the request reaches it. A browser sends the request again
    // on a fresh connection, and so does this; each is counted.
    const code = (error as { cause?: { code?: string } }).cause?.code;

    if (code !== 'ECONNRESET' && code !== 'UND_ERR_SOCKET') {
      throw error;
    }

    resent += 1;
    response = await send();
  }

  const text = await response.text();
  const ms = performance.now() - started;
  let parsed: unknown = text;

  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: a CSV, or an error page.
  }

  return { status: response.status, body: parsed as T, ms };
}

/**
 * Builds a multipart form with one file.
 *
 * @param field - The file's field.
 * @param filename - Its name.
 * @param bytes - Its bytes.
 * @param type - Its declared type.
 * @param fields - Other fields.
 * @returns The form.
 */
function formWith(
  field: string,
  filename: string,
  bytes: Buffer,
  type: string,
  fields: Record<string, string> = {},
): FormData {
  const form = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }

  form.append(field, new Blob([new Uint8Array(bytes)], { type }), filename);

  return form;
}

/**
 * Runs work over items, a few at a time.
 *
 * @param items - The items.
 * @param width - How many at once.
 * @param work - What to do with each.
 * @returns Each item's result, in order.
 */
async function inWaves<T, R>(
  items: readonly T[],
  width: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;

        results[index] = await work(items[index], index);
      }
    }),
  );

  return results;
}

// ----- Making people, places and exports -----

/** Everything the scenarios share beyond the operations stack's. */
class Load {
  readonly sampler: Sampler;
  readonly places: Place[] = [];
  readonly chatters: Person[] = [];
  private _people = 0;
  private _passwordHash: string | null = null;
  /** The scenarios asked for, by number; all of them when none were. */
  private readonly _only = new Set(
    (process.env.LOAD_SCENARIOS ?? '')
      .split(',')
      .map(entry => entry.trim().toUpperCase())
      .filter(Boolean),
  );

  /**
   * Whether a scenario was asked for. L1 always runs, because the others
   * use the Communities it makes.
   *
   * @param name - The scenario, starting with its number.
   * @returns True when it runs.
   */
  wanted(name: string): boolean {
    const number = name.split(' ')[0];

    return number === 'L1' || this._only.size === 0 || this._only.has(number);
  }

  /**
   * Creates an instance of Load.
   *
   * @param r - The operations stack's rehearsal.
   */
  constructor(readonly r: Rehearsal) {
    this.sampler = new Sampler(r);
  }

  /**
   * Makes people, in SQL, each with an access token signed with this run's
   * secret and an address of their own.
   *
   * @param label - What they are for.
   * @param count - How many.
   * @returns Them.
   */
  async people(label: string, count: number): Promise<Person[]> {
    // Nobody signs in with it; it is there because the column needs one.
    this._passwordHash ??= await bcrypt.hash(
      randomBytes(18).toString('hex'),
      10,
    );

    const made: Person[] = [];

    for (let i = 0; i < count; i++) {
      const id = randomUUID();
      const n = ++this._people;
      const email = `load-${label}-${n}-${id.slice(0, 6)}@rehearsal.example`;

      made.push({
        id,
        email,
        token: jwt.sign(
          { tokenUse: 'access', email, sub: id, role: 'USER' },
          this.r.secret.jwtSecret,
          { algorithm: 'HS256', expiresIn: '6h' },
        ),
        address: `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`,
      });
    }

    for (let start = 0; start < made.length; start += 200) {
      const batch = made.slice(start, start + 200);

      await this.r.db.query(
        `INSERT INTO "${SCHEMA}"."user" ("id", "email", "password", "emailVerified", "role")
         SELECT u."id", u."email", $2, true, 'USER'
           FROM jsonb_to_recordset($1::jsonb) AS u("id" uuid, "email" text)`,
        [
          JSON.stringify(batch.map(({ id, email }) => ({ id, email }))),
          this._passwordHash,
        ],
      );
      await this.r.db.query(
        `INSERT INTO "${SCHEMA}"."user_profile" ("userId", "username", "firstName", "lastName")
         SELECT u."id", u."username", 'Load', 'Rehearsal'
           FROM jsonb_to_recordset($1::jsonb) AS u("id" uuid, "username" text)`,
        [
          JSON.stringify(
            batch.map(({ id }, i) => ({
              id,
              username: `Load${label}${start + i}${id.slice(0, 4)}`,
            })),
          ),
        ],
      );
    }

    return made;
  }

  /**
   * Makes a Community and its Fleets, in SQL.
   *
   * @param owner - Its Owner.
   * @param index - Which, for its names.
   * @param fleets - How many Fleets.
   * @returns It.
   */
  async place(owner: Person, index: number, fleets: number): Promise<Place> {
    const communityId = randomUUID();

    await this.r.db.query(
      `INSERT INTO "${SCHEMA}"."fleet_community" ("id", "ownerUserId", "name", "slug")
       VALUES ($1, $2, $3, $4)`,
      [
        communityId,
        owner.id,
        `Load Community ${index}`,
        `load-community-${index}`,
      ],
    );

    const made: Place = { communityId, owner, fleets: [] };

    for (let f = 1; f <= fleets; f++) {
      const id = randomUUID();
      const name = `Load Fleet ${index}-${f}`;

      await this.r.db.query(
        `INSERT INTO "${SCHEMA}"."sto_fleet"
           ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug")
         SELECT $1, $2, "id", $3, $4, $5
           FROM "${SCHEMA}"."platform" WHERE "name" = 'Windows' AND "deletedAt" IS NULL`,
        [
          id,
          communityId,
          name,
          name.toLowerCase(),
          name.toLowerCase().replace(/ /g, '-'),
        ],
      );
      made.fleets.push({ id, name });
    }

    return made;
  }

  /**
   * Makes people approved members of a Fleet, in SQL.
   *
   * @param place - Its Community.
   * @param fleetId - The Fleet.
   * @param members - Who.
   */
  async approve(
    place: Place,
    fleetId: string,
    members: readonly Person[],
  ): Promise<void> {
    await this.r.db.query(
      `INSERT INTO "${SCHEMA}"."scope_membership"
         ("communityId", "fleetId", "userId", "status", "decidedAt", "decidedByUserId")
       SELECT $1, $2, m."id", 'APPROVED', now(), $3
         FROM jsonb_to_recordset($4::jsonb) AS m("id" uuid)`,
      [
        place.communityId,
        fleetId,
        place.owner.id,
        JSON.stringify(members.map(({ id }) => ({ id }))),
      ],
    );
  }
}

/** The fixture's header and its first row, the shape every row copies. */
function fixtureShape(r: Rehearsal): { header: string; row: string } {
  const [header, row] = readFileSync(join(r.config.repo, BASE_FIXTURE), 'utf8')
    .split(/\r?\n/)
    .filter(line => line !== '');

  return { header, row };
}

/**
 * Makes an export of a Fleet.
 *
 * Each row is the fixture's first, with its own name, handle and
 * contribution, so rosters are as wide as real ones. `drift` moves the
 * contributions on, so a history of exports has something to say.
 *
 * @param r - The rehearsal.
 * @param fleetName - The Fleet's name, as the filename has it.
 * @param stamp - The export's date, YYYYMMDD.
 * @param rows - How many members.
 * @param drift - How far along the history this export is.
 * @returns Its name and bytes.
 */
function exportOf(
  r: Rehearsal,
  fleetName: string,
  stamp: string,
  rows: number,
  drift = 0,
): { filename: string; bytes: Buffer } {
  const { header, row } = fixtureShape(r);
  const [, , ...rest] = row.split(',');
  const lines = [header];

  for (let i = 0; i < rows; i++) {
    const contribution = 1_000 + i * 17 + drift * 250;

    lines.push(
      [
        `Member ${String(i).padStart(4, '0')}`,
        `@load${String(i).padStart(4, '0')}`,
        rest[0],
        rest[1],
        rest[2],
        String(contribution),
        ...rest.slice(4),
      ].join(','),
    );
  }

  return {
    filename: `${fleetName}_${stamp}-120000.Csv`,
    bytes: Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'),
  };
}

/**
 * Uploads an export as a Fleet's Owner.
 *
 * @param load - The load.
 * @param place - The Fleet's Community.
 * @param fleetId - The Fleet.
 * @param file - The export.
 * @param address - Where it is sent from, when not the Owner's own.
 * @returns The import and its asset.
 */
async function uploadExport(
  load: Load,
  place: Place,
  fleetId: string,
  file: { filename: string; bytes: Buffer },
  address?: string,
): Promise<Upload> {
  const owner =
    address === undefined ? place.owner : { ...place.owner, address };
  const answer = await call<{ id?: string; assetId?: string }>(
    load.r,
    owner,
    'POST',
    `/fleet-communities/${place.communityId}/fleets/${fleetId}/roster-imports`,
    formWith('roster', file.filename, file.bytes, 'text/csv', {
      timezone: 'UTC',
    }),
  );

  if (answer.status !== 202 || !answer.body.id || !answer.body.assetId) {
    throw new Error(
      `Upload answered ${answer.status}: ${JSON.stringify(answer.body).slice(0, 300)}`,
    );
  }

  return { importId: answer.body.id, assetId: answer.body.assetId };
}

/**
 * Waits until every one of some imports is read into rows.
 *
 * @param r - The rehearsal.
 * @param uploads - The imports.
 * @param timeoutMs - How long to wait.
 * @returns How long it took, in seconds.
 */
async function allImported(
  r: Rehearsal,
  uploads: readonly Upload[],
  timeoutMs: number,
): Promise<number> {
  const waited = await waitFor(
    `${uploads.length} imports to be read into rows`,
    strictly(async () => {
      const [counts] = await r.db.query<{ available: number; read: number }>(
        `SELECT
           (SELECT count(*)::int FROM "${SCHEMA}"."file_asset"
             WHERE "id" = ANY($1::uuid[]) AND "state" = 'AVAILABLE') AS "available",
           (SELECT count(DISTINCT "importSourceId")::int
              FROM "${SCHEMA}"."fleet_roster_observation"
             WHERE "importSourceId" = ANY($2::uuid[])) AS "read"`,
        [uploads.map(u => u.assetId), uploads.map(u => u.importId)],
      );

      return (
        counts.available >= uploads.length && counts.read >= uploads.length
      );
    }),
    timeoutMs,
    2_000,
  );

  return waited.seconds;
}

/**
 * Makes a probe give up at once on a statement PostgreSQL refused as
 * written, rather than ask again until the wait runs out.
 *
 * @param probe - The probe.
 * @returns The same probe, stopping on a mistake in its SQL.
 */
function strictly<T>(probe: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await probe();
    } catch (error: unknown) {
      // Class 42: a syntax error or a name that does not exist.
      if (sqlState(error)?.startsWith('42')) {
        throw new StopWaiting(
          error instanceof Error ? error.message : String(error),
        );
      }

      throw error;
    }
  };
}

/**
 * Waits until every replay a set of Fleets has asked for is built.
 *
 * @param r - The rehearsal.
 * @param fleetIds - The Fleets.
 * @param timeoutMs - How long to wait.
 * @returns How long it took, in seconds.
 */
async function replaysSettled(
  r: Rehearsal,
  fleetIds: readonly string[],
  timeoutMs: number,
): Promise<number> {
  const waited = await waitFor(
    `the replays of ${fleetIds.length} Fleets to settle`,
    strictly(
      async () =>
        (await r.db.value<number>(
          `SELECT count(*)::int AS "value"
             FROM "${SCHEMA}"."fleet_roster_projection"
            WHERE "fleetId" = ANY($1::uuid[]) AND "built" < "requested"`,
          [fleetIds],
        )) === 0,
    ),
    timeoutMs,
    500,
  );

  return waited.seconds;
}

/**
 * Records a scenario's peaks against the budgets.
 *
 * @param r - The rehearsal.
 * @param name - The scenario.
 * @param peaks - What the sampler saw.
 */
function judgePeaks(r: Rehearsal, name: string, peaks: Peaks): void {
  r.results.check(
    name,
    `The backend stayed under ${BUDGET.backendMiB} MiB`,
    peaks.backendMiB > 0 && peaks.backendMiB < BUDGET.backendMiB,
    null,
    `peak ${peaks.backendMiB.toFixed(0)} MiB`,
  );
  r.results.check(
    name,
    `The worker and clamd stayed under ${BUDGET.workerAndScannerMiB} MiB together`,
    peaks.workerMiB + peaks.scannerMiB < BUDGET.workerAndScannerMiB,
    null,
    `worker ${peaks.workerMiB.toFixed(0)} MiB, clamd ${peaks.scannerMiB.toFixed(0)} MiB`,
  );
  r.results.check(
    name,
    `Each application held at most ${BUDGET.connectionsPerApplication} database connections`,
    peaks.backendConnections <= BUDGET.connectionsPerApplication &&
      peaks.workerConnections <= BUDGET.connectionsPerApplication,
    null,
    `backend ${peaks.backendConnections}, worker ${peaks.workerConnections}`,
  );
  r.results.check(
    name,
    `Redis's clients, twice over for a deploy, inside the plan's ${BUDGET.redisPlanClients}`,
    peaks.redisClients * 2 <= BUDGET.redisPlanClients,
    null,
    `peak ${peaks.redisClients} clients (${peaks.redisNames}), ${peaks.redisMiB.toFixed(1)} MiB; at most ${peaks.waitingJobs} jobs waiting`,
  );
}

/**
 * Runs a scenario with the sampler on, and judges its peaks.
 *
 * @param load - The load.
 * @param name - The scenario.
 * @param body - What it does.
 */
async function measured(
  load: Load,
  name: string,
  body: () => Promise<void>,
): Promise<void> {
  if (!load.wanted(name)) {
    return;
  }

  await scenario(load.r, name, async () => {
    const logFrom = load.r.backend?.log().length ?? 0;

    load.sampler.start();

    try {
      await body();
    } finally {
      judgePeaks(load.r, name, await load.sampler.stop());
      recordHeap(load.r, name, logFrom);
    }
  });
}

/**
 * Records the backend's own heap readings since a point in its log.
 *
 * The backend's memory diagnostics log `process.memoryUsage()` every few
 * seconds while the rehearsal runs; the heap is what a smaller instance has
 * to hold, whatever the operating system counts as resident around it.
 *
 * @param r - The rehearsal.
 * @param name - The scenario.
 * @param logFrom - Where in the backend's log the scenario began.
 */
function recordHeap(r: Rehearsal, name: string, logFrom: number): void {
  const readings = (r.backend?.log() ?? '')
    .slice(logFrom)
    .split(/\r?\n/)
    .map(line => /\{"reason".*\}/.exec(line)?.[0])
    .filter((json): json is string => json !== undefined)
    .map(
      json =>
        JSON.parse(json) as {
          rssBytes: number;
          heapUsedBytes: number;
          heapLimitBytes: number;
        },
    );

  if (readings.length === 0) {
    r.results.record(name, 'The backend’s heap', 'INFO', null, 'no reading');

    return;
  }

  const mib = (bytes: number): string => (bytes / 1_048_576).toFixed(0);
  const heap = Math.max(...readings.map(reading => reading.heapUsedBytes));
  const rss = Math.max(...readings.map(reading => reading.rssBytes));

  r.results.record(
    name,
    'The backend’s heap, as it reported it',
    'INFO',
    null,
    `heap used at most ${mib(heap)} MiB of a limit of ${mib(readings[0].heapLimitBytes)} MiB; resident at most ${mib(rss)} MiB (${readings.length} readings)`,
  );
}

// ----- L1 -----

/**
 * L1: the launch's Communities, Fleets and rosters, through the pipeline.
 *
 * @param load - The load.
 */
async function launchScale(load: Load): Promise<void> {
  const name = 'L1 Launch scale';
  const { r } = load;
  const started = Date.now();
  const owners = await load.people('owner', LAUNCH.communities);

  for (const [index, owner] of owners.entries()) {
    load.places.push(
      await load.place(owner, index + 1, LAUNCH.fleetsPerCommunity),
    );
  }

  const fleets = load.places.flatMap(place =>
    place.fleets.map(fleet => ({ place, fleet })),
  );

  r.results.record(
    name,
    `${load.places.length} Communities and ${fleets.length} Fleets made, with their Owners`,
    'INFO',
    secondsSince(started),
  );

  const uploading = Date.now();
  const uploads = await inWaves(fleets, 10, ({ place, fleet }) =>
    uploadExport(
      load,
      place,
      fleet.id,
      exportOf(r, fleet.name, '20260901', LAUNCH.membersPerFleet),
    ),
  );
  const sent = secondsSince(uploading);
  const seconds = await allImported(r, uploads, 3_600_000);

  await replaysSettled(
    r,
    fleets.map(({ fleet }) => fleet.id),
    600_000,
  );

  const members = await r.db.value<number>(
    `SELECT count(*)::int AS "value" FROM "${SCHEMA}"."fleet_roster_observation"
      WHERE "importSourceId" = ANY($1::uuid[])`,
    [uploads.map(u => u.importId)],
  );
  const perHour = (uploads.length / (sent + seconds)) * 3_600;

  r.results.check(
    name,
    `${fleets.length} rosters imported, ${LAUNCH.membersPerFleet} members each`,
    members === fleets.length * LAUNCH.membersPerFleet,
    sent + seconds,
    `${members} roster members; ${perHour.toFixed(0)} imports an hour`,
  );
}

// ----- L2 -----

/**
 * L2: what members read most, at 50 requests a second for a minute.
 *
 * @param load - The load.
 */
async function reads(load: Load): Promise<void> {
  const name = 'L2 Reads';
  const { r } = load;
  const targets = load.places.flatMap(place =>
    place.fleets.map(fleet => ({ place, fleet })),
  );
  const pages = [
    () => ({ who: null, path: '/fleet-communities' }),
    ({ place }: (typeof targets)[number]) => ({
      who: null,
      path: `/fleet-communities/${place.communityId}`,
    }),
    // A Fleet shows itself to its Community's members unless it chose
    // otherwise, so its page is read by somebody inside.
    ({ place, fleet }: (typeof targets)[number]) => ({
      who: place.owner,
      path: `/fleet-communities/${place.communityId}/fleets/${fleet.id}`,
    }),
    ({ place, fleet }: (typeof targets)[number]) => ({
      who: place.owner,
      path: `/fleet-communities/${place.communityId}/fleets/${fleet.id}/roster`,
    }),
    ({ place, fleet }: (typeof targets)[number]) => ({
      who: place.owner,
      path: `/fleet-communities/${place.communityId}/fleets/${fleet.id}/roster/history`,
    }),
    ({ place, fleet }: (typeof targets)[number]) => ({
      who: place.owner,
      path: `/fleet-communities/${place.communityId}/fleets/${fleet.id}/reports/ranks`,
    }),
  ];
  const timings: number[] = [];
  const refused: string[] = [];
  const pending: Promise<void>[] = [];
  const total = LAUNCH.readsPerSecond * LAUNCH.readSeconds;
  const gapMs = 1_000 / LAUNCH.readsPerSecond;
  const started = performance.now();

  // Open loop: requests go out on time whether or not earlier ones have
  // answered, as people's do.
  for (let i = 0; i < total; i++) {
    const due = started + i * gapMs;
    const wait = due - performance.now();

    if (wait > 0) {
      await sleep(wait);
    }

    const target = targets[i % targets.length];
    const page = pages[i % pages.length](target);

    pending.push(
      call(r, page.who, 'GET', page.path, undefined, `10.200.0.${i % 250}`)
        .then(answer => {
          timings.push(answer.ms);

          if (answer.status !== 200) {
            refused.push(`${answer.status} ${page.path.split('/').pop()}`);
          }
        })
        .catch((error: unknown) => {
          refused.push(error instanceof Error ? error.message : String(error));
        }),
    );
  }

  await Promise.all(pending);

  const achieved = total / ((performance.now() - started) / 1_000);

  r.results.check(
    name,
    `${total} reads at ${LAUNCH.readsPerSecond} a second answered with p95 under ${BUDGET.readP95Ms} ms`,
    percentile(timings, 0.95) < BUDGET.readP95Ms,
    LAUNCH.readSeconds,
    `${spread(timings)}; ${achieved.toFixed(1)} a second sent`,
  );
  r.results.check(
    name,
    'Every read was answered 200',
    refused.length === 0,
    null,
    refused.length === 0
      ? 'none refused'
      : `${refused.length} not: ${[...new Set(refused)].slice(0, 5).join('; ')}`,
  );
}

// ----- L3 -----

/**
 * L3: the import check on the largest export the parser accepts.
 *
 * @param load - The load.
 */
async function largeExportChecked(load: Load): Promise<void> {
  const name = 'L3 A large export checked';
  const { r } = load;
  const place = load.places[0];
  const fleet = place.fleets[0];
  const file = exportOf(r, fleet.name, '20260915', LAUNCH.previewRows);
  const timings: number[] = [];
  let failed = '';

  for (let i = 0; i < 20; i++) {
    const answer = await call<{ rowCount?: number }>(
      r,
      place.owner,
      'POST',
      `/fleet-communities/${place.communityId}/fleets/${fleet.id}/roster-imports/preview`,
      formWith('roster', file.filename, file.bytes, 'text/csv', {
        timezone: 'UTC',
      }),
    );

    timings.push(answer.ms);

    if (answer.status !== 200) {
      failed = `${answer.status}: ${JSON.stringify(answer.body).slice(0, 200)}`;
    }
  }

  r.results.check(
    name,
    `The check of a ${LAUNCH.previewRows}-row export (${(file.bytes.length / 1024).toFixed(0)} KiB) answered in under ${BUDGET.previewMs / 1_000} s`,
    failed === '' && percentile(timings, 0.95) < BUDGET.previewMs,
    null,
    failed === '' ? spread(timings) : failed,
  );

  // The same export imported: upload, scan, rows and replay, end to end.
  const started = Date.now();
  const upload = await uploadExport(load, place, fleet.id, file);

  await allImported(r, [upload], 600_000);
  await replaysSettled(r, [fleet.id], 600_000);
  r.results.record(
    name,
    `The same export imported end to end: upload, scan, rows and replay`,
    'INFO',
    secondsSince(started),
  );
}

// ----- L4 -----

/**
 * L4: a long history, replayed whole.
 *
 * @param load - The load.
 */
async function longHistoryReplayed(load: Load): Promise<void> {
  const name = 'L4 A long history replayed';
  const { r } = load;
  const place = load.places[1];
  const fleet = place.fleets[0];
  // Every three days from July 2023, after the fixture row's Join Date: an
  // export taken before a member's Join Date says they left and came back,
  // which real exports never say of a whole roster at once.
  const day = (n: number): string => {
    const date = new Date(Date.UTC(2023, 6, 1) + n * 3 * 86_400_000);

    return date.toISOString().slice(0, 10).replace(/-/g, '');
  };
  const building = Date.now();
  // Seeding, not the measured load: one Owner sending 300 exports in a few
  // minutes would meet the write limit, so they come from many addresses.
  const uploads = await inWaves(
    Array.from({ length: LAUNCH.replayExports }, (_, i) => i),
    10,
    i =>
      uploadExport(
        load,
        place,
        fleet.id,
        exportOf(r, fleet.name, day(i), LAUNCH.replayRows, i),
        `10.250.${i >> 8}.${i & 255}`,
      ),
  );

  await allImported(r, uploads, 3_600_000);
  await replaysSettled(r, [fleet.id], 3_600_000);

  const observations = await r.db.value<number>(
    `SELECT count(*)::int AS "value" FROM "${SCHEMA}"."fleet_roster_observation" o
       JOIN "${SCHEMA}"."fleet_roster_import_source" s ON s."id" = o."importSourceId"
      WHERE s."fleetId" = $1`,
    [fleet.id],
  );

  r.results.record(
    name,
    `${uploads.length} exports of ${LAUNCH.replayRows} rows imported into one Fleet, each replayed as it arrived`,
    'INFO',
    secondsSince(building),
    `${observations} rows in its history`,
  );

  const revision = await r.db.value<number>(
    `SELECT "revision" AS "value" FROM "${SCHEMA}"."fleet_roster_projection" WHERE "fleetId" = $1`,
    [fleet.id],
  );
  const replaying = Date.now();
  const excluded = await call(
    r,
    place.owner,
    'POST',
    `/fleet-communities/${place.communityId}/fleets/${fleet.id}/roster-imports/${uploads[0].importId}/exclusions`,
    { reason: REASON },
  );

  if (excluded.status >= 300) {
    throw new Error(
      `Setting the first export aside answered ${excluded.status}: ${JSON.stringify(excluded.body).slice(0, 200)}`,
    );
  }

  await waitFor(
    'the replay without the first export to be published',
    strictly(
      async () =>
        (await r.db.value<number>(
          `SELECT count(*)::int AS "value" FROM "${SCHEMA}"."fleet_roster_projection"
          WHERE "fleetId" = $1 AND "built" = "requested" AND "revision" > $2`,
          [fleet.id, revision ?? 0],
        )) === 1,
    ),
    // Long past the budget, so a slow replay is measured, not abandoned.
    1_800_000,
    250,
  );

  const seconds = secondsSince(replaying);

  r.results.check(
    name,
    `Setting the first export aside replayed all ${LAUNCH.replayExports - 1} others in under ${BUDGET.replaySeconds} s`,
    seconds < BUDGET.replaySeconds,
    seconds,
  );
}

// ----- L5 -----

/**
 * L5: an hour's imports, all at once.
 *
 * @param load - The load.
 */
async function importsArriving(load: Load): Promise<void> {
  const name = 'L5 Imports arriving';
  const { r } = load;
  const fleets = load.places
    .slice(2)
    .flatMap(place => place.fleets.map(fleet => ({ place, fleet })))
    .slice(0, LAUNCH.importsPerHour);
  const started = Date.now();
  const uploads = await Promise.all(
    fleets.map(({ place, fleet }) =>
      uploadExport(
        load,
        place,
        fleet.id,
        exportOf(r, fleet.name, '20260920', LAUNCH.membersPerFleet, 1),
      ),
    ),
  );

  await allImported(r, uploads, 3_600_000);
  await replaysSettled(
    r,
    fleets.map(({ fleet }) => fleet.id),
    3_600_000,
  );

  const seconds = secondsSince(started);

  r.results.check(
    name,
    `${uploads.length} imports sent at once were in force well inside the hour`,
    seconds < 3_600 / 4,
    seconds,
    `${((uploads.length / seconds) * 3_600).toFixed(0)} an hour at this rate`,
  );
}

// ----- L6 -----

/**
 * L6: an hour's pictures, all at once, as profile pictures.
 *
 * @param load - The load.
 */
async function picturesScanned(load: Load): Promise<void> {
  const name = 'L6 Pictures scanned';
  const { r } = load;
  const senders = [
    ...load.places.map(place => place.owner),
    ...load.chatters,
  ].slice(0, LAUNCH.scansPerHour);

  // A picture publishes to Cloudflare Images, which this stack cannot reach;
  // held after its scan, it shows the scan just as well.
  await r.publication('pause');

  try {
    const started = Date.now();
    const sent = await inWaves(senders, 20, async (person, i) => {
      const answer = await call(
        r,
        person,
        'POST',
        '/user/update-profile-pic',
        formWith(
          'profilePicture',
          `load-${i}.png`,
          png(i & 255, (i * 7) & 255, (i * 13) & 255),
          'image/png',
        ),
      );

      return answer.status;
    });
    const refused = sent.filter(status => status >= 300);

    r.results.check(
      name,
      `${senders.length} pictures accepted at the door`,
      refused.length === 0,
      secondsSince(started),
      refused.length === 0 ? '' : `refused: ${refused.join(', ')}`,
    );

    const waited = await waitFor(
      `${senders.length} pictures to be scanned`,
      strictly(
        async () =>
          ((await r.db.value<number>(
            `SELECT count(*)::int AS "value" FROM "${SCHEMA}"."file_asset"
            WHERE "ownerUserId" = ANY($1::uuid[]) AND "state" NOT IN ('QUARANTINED', 'SCANNING', 'RETRY_PENDING')`,
            [senders.map(person => person.id)],
          )) ?? 0) >= senders.length,
      ),
      3_600_000,
      2_000,
    );
    const seconds = secondsSince(started);
    const latencies = await r.db.query<{ ms: number }>(
      `SELECT extract(epoch FROM (t."completedAt" - a."createdAt")) * 1000 AS "ms"
         FROM "${SCHEMA}"."file_asset" a
         JOIN "sto_info_worker"."file_scan_attempt" t ON t."assetId" = a."id"
        WHERE a."ownerUserId" = ANY($1::uuid[]) AND t."completedAt" IS NOT NULL
          AND a."createdAt" >= $2`,
      [senders.map(person => person.id), new Date(started)],
    );

    r.results.check(
      name,
      `${senders.length} pictures, an hour's worth, scanned well inside the hour`,
      seconds < 3_600 / 4,
      waited.seconds,
      `${((senders.length / seconds) * 3_600).toFixed(0)} an hour at this rate; upload to verdict ${spread(latencies.map(row => Number(row.ms)))}`,
    );
  } finally {
    await r.publication('resume');
  }
}

// ----- L7 -----

/** A chat message as the socket gives it. */
interface Message {
  id: string;
  clientMessageId: string;
}

/** What every client event is answered with. */
type Ack<T> = { ok: true; data: T } | { ok: false; error: { status: number } };

/**
 * Opens a socket and signs it in.
 *
 * @param r - The rehearsal.
 * @param person - Whose.
 * @returns The socket.
 */
async function connect(r: Rehearsal, person: Person): Promise<Socket> {
  const socket = io(`http://127.0.0.1:${r.config.ports.backend}/chat`, {
    path: '/chat/socket',
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { ...originHeaders(), 'CF-Connecting-IP': person.address },
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

  const ack = (await socket
    .timeout(10_000)
    .emitWithAck('auth', { token: person.token })) as Ack<unknown>;

  if (!ack.ok) {
    throw new Error(`Chat sign-in refused: ${ack.error.status}`);
  }

  return socket;
}

/**
 * L7: 200 sockets in ten Fleets, 20 messages a second.
 *
 * @param load - The load.
 */
async function chat(load: Load): Promise<void> {
  const name = 'L7 Chat';
  const { r } = load;
  const places = load.places.slice(10, 10 + LAUNCH.chatFleets);
  const rooms: Array<{ channelId: string; members: Person[] }> = [];

  for (const [i, place] of places.entries()) {
    const members = load.chatters.slice(
      i * LAUNCH.socketsPerFleet,
      (i + 1) * LAUNCH.socketsPerFleet,
    );
    const fleetId = place.fleets[0].id;

    await load.approve(place, fleetId, members);
    await r.db.query(
      `INSERT INTO "${SCHEMA}"."chat_channel" ("communityId", "fleetId", "kind", "name")
       SELECT $1, $2, 'STANDARD', 'General'
        WHERE NOT EXISTS (SELECT 1 FROM "${SCHEMA}"."chat_channel" WHERE "fleetId" = $2 AND "kind" = 'STANDARD')`,
      [place.communityId, fleetId],
    );
    rooms.push({
      channelId: (await r.db.value<string>(
        `SELECT "id" AS "value" FROM "${SCHEMA}"."chat_channel" WHERE "fleetId" = $1 AND "kind" = 'STANDARD'`,
        [fleetId],
      ))!,
      members,
    });
  }

  const sockets: Socket[] = [];

  try {
    const connecting = Date.now();
    const joined = await inWaves(
      rooms.flatMap(room =>
        room.members.map(member => ({ member, channelId: room.channelId })),
      ),
      20,
      async ({ member, channelId }) => {
        const socket = await connect(r, member);

        sockets.push(socket);

        const ack = (await socket
          .timeout(10_000)
          .emitWithAck('join', { channelId })) as Ack<unknown>;

        if (!ack.ok) {
          throw new Error(`Joining answered ${ack.error.status}`);
        }

        return { socket, channelId };
      },
    );

    r.results.record(
      name,
      `${joined.length} sockets signed in and joined ${rooms.length} General channels`,
      'INFO',
      secondsSince(connecting),
    );

    const sentAt = new Map<string, number>();
    const acks: number[] = [];
    const deliveries: number[] = [];
    let duplicates = 0;
    let refusedPosts = 0;

    for (const { socket } of joined) {
      const seen = new Set<string>();

      socket.on('message', (message: Message) => {
        if (seen.has(message.id)) {
          duplicates += 1;
        }

        seen.add(message.id);

        const marked = sentAt.get(message.clientMessageId);

        if (marked !== undefined) {
          deliveries.push(performance.now() - marked);
        }
      });
    }

    const posters = rooms.flatMap(room =>
      joined
        .filter(entry => entry.channelId === room.channelId)
        .slice(0, LAUNCH.postersPerFleet),
    );
    // Each poster's share of 20 a second: inside chat's own limit of ten in
    // any ten seconds.
    const everyMs = (posters.length / LAUNCH.messagesPerSecond) * 1_000;
    const stopAt = performance.now() + LAUNCH.chatSeconds * 1_000;

    await Promise.all(
      posters.map(async ({ socket, channelId }, i) => {
        await sleep((i * everyMs) / posters.length);

        while (performance.now() < stopAt) {
          const next = performance.now() + everyMs;
          const clientMessageId = randomUUID();
          const sent = performance.now();

          sentAt.set(clientMessageId, sent);

          const ack = (await socket.timeout(10_000).emitWithAck('send', {
            channelId,
            body: `Load ${clientMessageId.slice(0, 8)}`,
            clientMessageId,
          })) as Ack<Message>;

          if (ack.ok) {
            acks.push(performance.now() - sent);
          } else {
            refusedPosts += 1;
          }

          await sleep(Math.max(0, next - performance.now()));
        }
      }),
    );
    await sleep(3_000);

    const expected = acks.length * LAUNCH.socketsPerFleet;

    r.results.check(
      name,
      `${acks.length} messages in ${LAUNCH.chatSeconds} s acknowledged with p95 under ${BUDGET.chatP95Ms} ms`,
      refusedPosts === 0 && percentile(acks, 0.95) < BUDGET.chatP95Ms,
      LAUNCH.chatSeconds,
      `${(acks.length / LAUNCH.chatSeconds).toFixed(1)} a second; ${spread(acks)}; ${refusedPosts} refused`,
    );
    r.results.check(
      name,
      `Every message reached every reader in its channel once, with p95 under ${BUDGET.chatP95Ms} ms`,
      deliveries.length === expected &&
        duplicates === 0 &&
        percentile(deliveries, 0.95) < BUDGET.chatP95Ms,
      null,
      `${deliveries.length}/${expected} delivered, ${duplicates} doubled; ${spread(deliveries)}`,
    );
  } finally {
    for (const socket of sockets) {
      socket.disconnect();
    }
  }
}

// ----- Running -----

/** Runs the rehearsal. */
async function main(): Promise<void> {
  const r = new Rehearsal(TITLE);
  const load = new Load(r);
  const started = new Date();

  // A socket or connection dropped under load must not end the run before
  // the results and the logs are written.
  process.on('uncaughtException', (error: Error) => {
    console.error(`Uncaught: ${error.message}`);
  });

  const heapMib = process.env.LOAD_BACKEND_HEAP_MIB ?? '384';

  r.backendExtra = {
    MEMORY_DIAGNOSTICS_ENABLED: 'true',
    // Every three seconds.
    MEMORY_DIAGNOSTICS_INTERVAL_MINUTES: '0.05',
    // Production's heap cap on its 512 MB plan (Steve, 4 October 2026), so
    // the run measures what Render runs. LOAD_BACKEND_HEAP_MIB sets another;
    // 0 leaves Node to choose, as it did before the decision.
    ...(heapMib === '0'
      ? {}
      : { NODE_OPTIONS: `--max-old-space-size=${heapMib}` }),
  };
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

    load.chatters.push(
      ...(await load.people(
        'chat',
        LAUNCH.chatFleets * LAUNCH.socketsPerFleet,
      )),
    );

    // What the backend holds at rest, before any load.
    await sleep(10_000);
    load.sampler.start();
    await sleep(6_000);
    r.results.record(
      'S1 Cold start',
      'The backend at rest, before any load',
      'INFO',
      null,
      `resident ${(await load.sampler.stop()).backendMiB.toFixed(0)} MiB`,
    );
    recordHeap(r, 'S1 Cold start', 0);

    await measured(load, 'L1 Launch scale', () => launchScale(load));
    await measured(load, 'L2 Reads', () => reads(load));
    await measured(load, 'L3 A large export checked', () =>
      largeExportChecked(load),
    );
    await measured(load, 'L4 A long history replayed', () =>
      longHistoryReplayed(load),
    );
    await measured(load, 'L5 Imports arriving', () => importsArriving(load));
    await measured(load, 'L6 Pictures scanned', () => picturesScanned(load));
    await measured(load, 'L7 Chat', () => chat(load));

    await r.checkNothingUnscanned('All');
    r.results.record(
      'All',
      'Requests sent again on a fresh connection after a kept-alive one was reset',
      'INFO',
      null,
      String(resent),
    );
  } finally {
    await load.sampler.close();
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
      '- The operations rehearsal’s stack and cold start (S1), then FC-044’s scenarios L1 to L7 at the launch load Steve agreed on 2 October 2026.',
      '- One backend and one worker, as at launch. Memory is each process’s resident set; clamd’s is its container’s.',
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
