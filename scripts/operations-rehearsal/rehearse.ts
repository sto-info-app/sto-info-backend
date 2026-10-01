/**
 * Rehearses restarts, outages, a restore and a rollback of the file pipeline,
 * and records how long each took (FC-042).
 *
 * Run it through `npm run rehearse:operations`, which builds both
 * applications, creates the containers and removes everything afterwards.
 * `README.md` beside it says what each scenario proves.
 *
 * Every upload is a roster import of a synthetic export derived from the
 * test fixtures: a restricted file that goes quarantine → scan → publish into
 * rows without touching Cloudflare. The two pictures in the restore scenario
 * are never scanned before the database is restored under them, and nothing
 * either application does can leave the machine (see {@link EgressGuard}).
 */
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { crc32, deflateSync } from 'node:zlib';

import bcrypt from 'bcrypt';
import { QueryRunner } from 'typeorm';

import {
  LOCAL_FIXTURE_COMMUNITY_ID,
  LOCAL_FIXTURE_PC_FLEET_ID,
  SeedLocalFleetFixtures1794000000000,
} from '../../src/database/migrations/1794000000000-SeedLocalFleetFixtures';
import {
  LEDGER_ACTIONS_DOWN_REFUSAL,
  RecordLedgerReconciliation1797200000000,
} from '../../src/database/migrations/1797200000000-RecordLedgerReconciliation';
import {
  PUBLISHED_IMAGE_GUARD_DOWN_REFUSAL,
  PUBLISHED_IMAGE_GUARD_SQLSTATE,
} from '../../src/database/migrations/1797300000000-GuardPublishedImageReferences';
import { OPERATIONS_ACTIONS } from '../../src/database/migrations/1797500000000-AddOperationsAlerts';
import { HOLD_REPLAYED_REASON } from '../../src/fleet/chat/holds/hold-ledger-reconciliation.service';
import { GATED_CLOUDFLARE_SECRET_KEYS } from '../../src/shared/utilities/image-uploads.service';
import {
  Api,
  AppProcess,
  BUCKETS,
  cleanEnvironment,
  Containers,
  createBuckets,
  Database,
  DATABASES,
  docker,
  EgressGuard,
  failedJobCounts,
  generated,
  MINIO_USER,
  nodePath,
  pingClamd,
  pingRedis,
  QUEUE_PREFIX,
  queueIsPaused,
  readConfig,
  removeScanRequest,
  runNode,
  secondsSince,
  SECRET_NAME,
  secretKeys,
  seedSecret,
  Service,
  sqlState,
  StackConfig,
  StopWaiting,
  waitFor,
} from './stack';

/** The secret key names a build from before FC-042 reads. */
const OLD_CLOUDFLARE_SECRET_KEYS = [
  'cloudflareR2AccessKey',
  'cloudflareR2Secret',
  'cloudflareImagesApiKey',
] as const;

/** The roster fixture every upload is derived from. */
const BASE_FIXTURE =
  'test/fixtures/fleet-community/Fixture Basic Fleet_20240101-120000.Csv';

/** A member who is in the base fixture, erased in the restore scenario. */
const ERASED_IN_RESTORE = {
  characterName: 'Dax Orlan',
  accountHandle: '@fixture002',
} as const;

/**
 * The backend's migrations before `1790000600000-SeedStorytimeTags`, as a
 * glob relative to the build: everything from 17000… to 1790000599999.
 */
const BEFORE_STORYTIME_TAGS =
  'src/database/migrations/{17[0-8]*,1790000[0-5]*}.js';

/** How long a cron-driven alert can take: one tick, plus its run. */
const ALERT_TICK_MS = 150_000;

/** The worker's scan lease by default, which bounds a crashed scan's recovery. */
const DEFAULT_SCAN_LEASE_MS = 300_000;

/** A reason, for every admin action the rehearsal takes. */
const REASON =
  'Operations rehearsal (FC-042): synthetic data on a throwaway stack.';

type Outcome = 'PASS' | 'FAIL' | 'INFO';

/** One line of the results table. */
interface ResultRow {
  readonly scenario: string;
  readonly step: string;
  readonly seconds: number | null;
  readonly outcome: Outcome;
  readonly note: string;
}

/** What the rehearsal found, in order. */
export class Results {
  readonly rows: ResultRow[] = [];

  /**
   * Creates an instance of Results.
   *
   * @param _title - The results page's heading.
   */
  constructor(
    private readonly _title = 'Operations rehearsal results (FC-042)',
  ) {}

  /**
   * Records a line and prints it.
   *
   * @param scenario - Which scenario.
   * @param step - What was done or checked.
   * @param outcome - How it went.
   * @param seconds - How long it took, where that means anything.
   * @param note - What was seen.
   */
  record(
    scenario: string,
    step: string,
    outcome: Outcome,
    seconds: number | null = null,
    note = '',
  ): void {
    this.rows.push({ scenario, step, seconds, outcome, note });

    const timing = seconds === null ? '' : ` [${seconds.toFixed(1)} s]`;
    const line = `  ${outcome.padEnd(4)}  ${scenario}: ${step}${timing}${note === '' ? '' : ` — ${note}`}`;

    if (outcome === 'FAIL') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  /**
   * Records whether an expectation held.
   *
   * @param scenario - Which scenario.
   * @param step - What was checked.
   * @param held - Whether it held.
   * @param seconds - How long it took, where that means anything.
   * @param note - What was seen.
   * @returns Whether it held.
   */
  check(
    scenario: string,
    step: string,
    held: boolean,
    seconds: number | null = null,
    note = '',
  ): boolean {
    this.record(scenario, step, held ? 'PASS' : 'FAIL', seconds, note);

    return held;
  }

  /** How many lines failed. */
  get failures(): number {
    return this.rows.filter(row => row.outcome === 'FAIL').length;
  }

  /**
   * Writes the results as Markdown.
   *
   * @param path - Where.
   * @param preamble - What ran, against what.
   */
  write(path: string, preamble: string[]): void {
    const cell = (text: string) => text.replace(/\|/g, '\\|');
    const lines = [
      `# ${this._title}`,
      '',
      ...preamble,
      '',
      '| Scenario | Step | Seconds | Result | Note |',
      '| --- | --- | ---: | --- | --- |',
      ...this.rows.map(
        row =>
          `| ${cell(row.scenario)} | ${cell(row.step)} | ` +
          `${row.seconds === null ? '' : row.seconds.toFixed(1)} | ` +
          `${row.outcome} | ${cell(row.note)} |`,
      ),
      '',
      `${this.rows.filter(row => row.outcome === 'PASS').length} passed, ` +
        `${this.failures} failed, ` +
        `${this.rows.filter(row => row.outcome === 'INFO').length} recorded.`,
      '',
    ];

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, lines.join('\n'), 'utf8');
  }
}

/** An upload the rehearsal made, and what it is watched by. */
export interface Upload {
  readonly importId: string;
  readonly assetId: string;
}

/** Everything the scenarios share. */
export class Rehearsal {
  readonly config: StackConfig = readConfig();
  readonly results: Results;
  readonly containers = new Containers(this.config.prefix);
  readonly egress = new EgressGuard();
  readonly api = new Api(this.config.ports.backend);
  readonly adminEmail = 'ops-rehearsal-admin@rehearsal.example';
  readonly adminPassword = generated(18);
  readonly adminId = randomUUID();
  readonly applicantEmail = 'ops-rehearsal-applicant@rehearsal.example';
  readonly applicantPassword = generated(18);
  readonly secret: Record<string, string>;
  readonly logs: string;
  databaseName: string = DATABASES.main;
  db: Database;
  backend: AppProcess | null = null;
  worker: AppProcess | null = null;
  /** When the older release ran, so what it tried is told apart. */
  oldReleaseWindow: [number, number] = [0, 0];
  private _launches = 0;
  private _variant = 0;
  private readonly _fixture: string;

  /**
   * Creates an instance of Rehearsal.
   *
   * @param title - The results page's heading; the adversarial rehearsal
   *   (FC-043) runs on this one's stack under its own.
   */
  constructor(title?: string) {
    this.results = new Results(title);
    this.db = new Database(this.config, this.databaseName);
    this.logs = join(this.config.work, 'logs');
    mkdirSync(this.logs, { recursive: true });

    for (const app of ['backend', 'worker']) {
      const dir = join(this.config.work, `run-${app}`);

      mkdirSync(dir, { recursive: true });
      copyFileSync(
        join(
          app === 'backend' ? this.config.repo : this.config.workerRepo,
          'package.json',
        ),
        join(dir, 'package.json'),
      );
    }

    this._fixture = readFileSync(join(this.config.repo, BASE_FIXTURE), 'utf8');

    // Every key either application reads, under FC-042's names only, and
    // every value made up for this run. The bucket keys are MinIO's, which is
    // the one credential here that has to work.
    this.secret = {
      dbPassword: this.config.postgresPassword,
      jwtSecret: generated(),
      sendGridApiKey: generated(),
      sesEmailHmacSecret: generated(),
      rosterErasureKey: generated(),
      cloudflareImagesAccountId: 'ops-rehearsal',
      cloudflareImagesGatedApiKey: generated(),
      cloudflareImagesSigningKey: generated(),
      cloudflareR2GatedAccessKey: MINIO_USER,
      cloudflareR2GatedSecret: this.config.minioPassword,
      cloudflareR2QuarantineAccessKey: MINIO_USER,
      cloudflareR2QuarantineSecret: this.config.minioPassword,
      cloudflareR2QuarantineReadKey: MINIO_USER,
      cloudflareR2QuarantineReadSecret: this.config.minioPassword,
      cloudflareR2ExportsAccessKey: MINIO_USER,
      cloudflareR2ExportsSecret: this.config.minioPassword,
    };
  }

  /**
   * What both applications are given, whichever they are.
   *
   * @returns The variables.
   */
  private sharedVariables(): Record<string, string> {
    const { ports, work } = this.config;
    const egress = `http://127.0.0.1:${ports.egress}`;

    return {
      NODE_ENV: 'local',
      LOG_LEVEL: 'log',
      TZ: 'UTC',
      NO_COLOR: '1',
      AWS_ACCESS_KEY_ID: 'ops-rehearsal',
      AWS_SECRET_ACCESS_KEY: 'ops-rehearsal',
      AWS_REGION: 'eu-west-2',
      AWS_SECRET_NAME: SECRET_NAME,
      // The SDK's own variable: every AWS client goes to the local stand-in.
      AWS_ENDPOINT_URL: `http://127.0.0.1:${ports.aws}`,
      AWS_CONFIG_FILE: join(work, 'no-aws-config'),
      AWS_SHARED_CREDENTIALS_FILE: join(work, 'no-aws-config'),
      DB_TYPE: 'postgres',
      DB_HOST: '127.0.0.1',
      DB_PORT: String(ports.postgres),
      DB_NAME: this.databaseName,
      DB_USERNAME: 'postgres',
      DB_SSL_REJECT_UNAUTHORIZED: 'false',
      REDIS_URL: `redis://127.0.0.1:${ports.redis}`,
      QUEUE_PREFIX,
      TYPEORM_LOGGING: 'false',
      TYPEORM_ENTITIES: 'src/**/*.entity.{js,ts}',
      TYPEORM_MIGRATIONS: 'src/database/migrations/*.{js,ts}',
      CLOUDFLARE_R2_ENDPOINT: `http://127.0.0.1:${ports.minio}`,
      CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME: BUCKETS.quarantine,
      HTTP_PROXY: egress,
      HTTPS_PROXY: egress,
      http_proxy: egress,
      https_proxy: egress,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      NODE_USE_ENV_PROXY: '1',
    };
  }

  /**
   * The backend's environment: the template's variables, set for this stack.
   *
   * @param build - The build's output directory.
   * @param checkout - The checkout it was built from.
   * @returns The environment.
   */
  backendEnvironment(
    build = join(this.config.work, 'backend'),
    checkout = this.config.repo,
  ): NodeJS.ProcessEnv {
    return cleanEnvironment({
      ...this.sharedVariables(),
      NODE_PATH: nodePath(build, checkout),
      APP_PORT: String(this.config.ports.backend),
      APP_FRONTEND_URL: 'http://localhost:4200',
      APP_TITLE: 'Operations rehearsal',
      AUTH_SALT_ROUNDS: '10',
      AUTH_TOKEN_EXPIRES_IN: '36000',
      AUTH_REFRESH_TOKEN_EXPIRES_IN: '72000',
      DB_SCHEMA: 'sto_info_app',
      TYPEORM_SYNCHRONIZE: 'false',
      EMAIL_NOREPLY_SENDER: 'no-reply@rehearsal.example',
      AWS_SNS_TOPIC_ARN: 'arn:aws:sns:eu-west-2:000000000000:ops-rehearsal',
      AWS_SES_CONFIGURATION_SET: 'ops-rehearsal',
      SES_AUDIT_RETENTION_DAYS: '180',
      SES_SUPPRESSION_RETENTION_DAYS: '2557',
      CLOUDFLARE_R2_BUCKET_NAME: BUCKETS.delivery,
      CLOUDFLARE_R2_EXPORTS_BUCKET_NAME: BUCKETS.exports,
      CLOUDFLARE_CDN_ROOT_URL: 'https://cdn.rehearsal.example',
      CLOUDFLARE_IMAGES_HASH: 'ops-rehearsal',
      MAX_IMAGE_SIZE_IN_BYTES: '10485760',
      AUDIT_DATA_NUKE_THRESHOLD_DAYS: '3',
      AUDIT_IP_NUKE_THRESHOLD_DAYS: '1',
      CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS: '21',
      CONTACT_REQUEST_RECORD_RETENTION_DAYS: '90',
      CLOSED_ACCOUNT_RETENTION_DAYS: '180',
      TRUST_PROXY_HOPS: '1',
      STARTUP_DIAGNOSTICS: 'false',
      SENTRY_DSN: '',
      MEMORY_DIAGNOSTICS_ENABLED: 'false',
      // Read by the local seed migration; a person for the moderation hold.
      DATASEED_FLEET_APPLICANT_EMAIL: this.applicantEmail,
      DATASEED_FLEET_APPLICANT_USERNAME: 'OpsRehearsalApplicant',
      DATASEED_FLEET_APPLICANT_PASSWORD: this.applicantPassword,
      // Read by the local demo-account seed, which refuses to run without it.
      DATASEED_USER_PASSWORD: this.applicantPassword,
    });
  }

  /**
   * The worker's environment.
   *
   * @returns The environment.
   */
  workerEnvironment(): NodeJS.ProcessEnv {
    return cleanEnvironment({
      ...this.sharedVariables(),
      NODE_PATH: nodePath(
        join(this.config.work, 'worker'),
        this.config.workerRepo,
      ),
      APP_PORT: String(this.config.ports.worker),
      APP_TITLE: 'Operations rehearsal worker',
      DB_SCHEMA: 'sto_info_worker',
      CLAMAV_HOST: '127.0.0.1',
      CLAMAV_PORT: String(this.config.ports.clamd),
      // The image's signatures are as old as the image. Everything else is
      // the deployed default, the scan lease included.
      CLAMAV_MAX_DEFINITION_AGE_HOURS: '720',
      BACKEND_DB_ROLE: 'postgres',
    });
  }

  /**
   * Points everything at another database, as a restore does.
   *
   * @param name - The database.
   */
  async useDatabase(name: string): Promise<void> {
    await this.db.close();
    this.databaseName = name;
    this.db = new Database(this.config, name);
  }

  /**
   * Starts the backend.
   *
   * @param label - What this launch is for, in the log's name.
   * @param main - Which build; the current one unless a rollback says.
   * @returns The process.
   */
  startBackend(label: string, main = this.config.backendMain): AppProcess {
    const old = main !== this.config.backendMain;
    const build = old
      ? dirname(dirname(main))
      : join(this.config.work, 'backend');
    const checkout = old ? dirname(build) : this.config.repo;

    this.backend = new AppProcess(
      'backend',
      main,
      join(this.config.work, 'run-backend'),
      this.backendEnvironment(build, checkout),
      join(
        this.logs,
        `${String(++this._launches).padStart(2, '0')}-backend-${label}.log`,
      ),
      join(this.config.work, 'pids'),
    );

    return this.backend;
  }

  /**
   * Starts the worker.
   *
   * @param label - What this launch is for, in the log's name.
   * @returns The process.
   */
  startWorker(label: string): AppProcess {
    this.worker = new AppProcess(
      'worker',
      this.config.workerMain,
      join(this.config.work, 'run-worker'),
      this.workerEnvironment(),
      join(
        this.logs,
        `${String(++this._launches).padStart(2, '0')}-worker-${label}.log`,
      ),
      join(this.config.work, 'pids'),
    );

    return this.worker;
  }

  /**
   * Waits for the backend to answer `/health/ready`.
   *
   * @param timeoutMs - How long to wait.
   * @returns How long it took.
   */
  async backendReady(timeoutMs = 180_000): Promise<number> {
    const started = Date.now();

    await waitFor(
      'the backend to be ready',
      async () => {
        if (this.backend !== null && !this.backend.running) {
          throw new StopWaiting(
            `the backend exited with ${this.backend.exitCode}; see ${basename(this.backend.logPath)}`,
          );
        }

        return this.api.ready();
      },
      timeoutMs,
      250,
    );

    return secondsSince(started);
  }

  /**
   * Waits for a worker started at or after a moment to beat as `RUNNING`.
   *
   * @param since - The moment, from `Date.now()`.
   * @param timeoutMs - How long to wait.
   * @returns The heartbeat row and how long it took.
   */
  async workerRunning(
    since: number,
    timeoutMs = 180_000,
  ): Promise<{ workerId: string; seconds: number }> {
    const waited = await waitFor(
      'a worker heartbeat saying RUNNING',
      async () => {
        if (this.worker !== null && !this.worker.running) {
          throw new StopWaiting(
            `the worker exited with ${this.worker.exitCode}`,
          );
        }

        const rows = await this.db.query<{ workerId: string }>(
          `SELECT "workerId" FROM "sto_info_worker"."worker_heartbeat_status"
            WHERE "state" = 'RUNNING' AND "startedAt" >= to_timestamp($1)
            ORDER BY "startedAt" DESC LIMIT 1`,
          [(since - 5_000) / 1000],
        );

        return rows[0]?.workerId ?? null;
      },
      timeoutMs,
    );

    return { workerId: waited.value, seconds: waited.seconds };
  }

  /**
   * Makes sure the stack is whole before a scenario starts, so one that
   * failed half-way does not take the next one with it.
   */
  async ensureWhole(): Promise<void> {
    for (const service of ['pg', 'redis', 'minio', 'clamd', 'aws'] as const) {
      const state = await this.containerState(service);

      if (state === 'paused') {
        await this.containers.unpause(service);
      } else if (state !== 'running') {
        await this.containers.start(service);
      }
    }

    await waitFor('clamd', () => pingClamd(this.config.ports.clamd), 300_000);

    if (this.backend === null || !this.backend.running) {
      this.startBackend('recovered');
    }

    await this.backendReady();

    if (this.worker === null || !this.worker.running) {
      const since = Date.now();

      this.startWorker('recovered');
      await this.workerRunning(since);
    }
  }

  /**
   * Reads a container's state.
   *
   * @param service - Which.
   * @returns Docker's word for it.
   */
  async containerState(service: Service): Promise<string> {
    return docker(
      'inspect',
      '--format',
      '{{.State.Status}}',
      this.containers.name(service),
    );
  }

  /**
   * Makes a roster export of the fixture Fleet no earlier upload has made:
   * a later filename stamp, one figure changed and, when asked, one more
   * member. Every value is synthetic.
   *
   * @param extra - A member to add.
   * @returns Its name and bytes.
   */
  rosterExport(extra?: { characterName: string; accountHandle: string }): {
    filename: string;
    bytes: Buffer;
  } {
    const n = ++this._variant;
    const day = new Date(Date.UTC(2024, 1, 1 + n));
    const stamp = day.toISOString().slice(0, 10).replace(/-/g, '');
    const lines = this._fixture.split('\n').filter(line => line !== '');

    lines[1] = lines[1].replace(',120500,', `,${120500 + n},`);

    if (extra !== undefined) {
      lines.push(
        lines[2]
          .replace(ERASED_IN_RESTORE.characterName, extra.characterName)
          .replace(ERASED_IN_RESTORE.accountHandle, extra.accountHandle),
      );
    }

    return {
      filename: `Fixture Basic Fleet_${stamp}-120000.Csv`,
      bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
    };
  }

  /**
   * Uploads a roster export for the fixture Fleet.
   *
   * @param extra - A member to add.
   * @param timeoutMs - How long to wait for an answer.
   * @returns The import and its asset.
   * @throws Error when it is not accepted.
   */
  async uploadRoster(
    extra?: { characterName: string; accountHandle: string },
    timeoutMs = 30_000,
  ): Promise<Upload> {
    const roster = this.rosterExport(extra);
    const answer = await this.api.upload<{ id?: string; assetId?: string }>(
      `/fleet-communities/${LOCAL_FIXTURE_COMMUNITY_ID}/fleets/${LOCAL_FIXTURE_PC_FLEET_ID}/roster-imports`,
      'roster',
      roster.filename,
      roster.bytes,
      'text/csv',
      { timezone: 'UTC' },
      timeoutMs,
    );

    if (answer.status !== 202 || !answer.body.id || !answer.body.assetId) {
      throw new Error(
        `Roster upload answered ${answer.status}: ${JSON.stringify(answer.body).slice(0, 300)}`,
      );
    }

    return { importId: answer.body.id, assetId: answer.body.assetId };
  }

  /**
   * An asset's state.
   *
   * @param assetId - The asset.
   * @returns Its state, or null when the database has no such asset.
   */
  async assetState(assetId: string): Promise<string | null> {
    return this.db.value<string>(
      `SELECT "state"::text AS "value" FROM "sto_info_app"."file_asset" WHERE "id" = $1`,
      [assetId],
    );
  }

  /**
   * The worker's latest attempt at an asset.
   *
   * @param assetId - The asset.
   * @returns Its state, or null when there is none.
   */
  async attemptState(assetId: string): Promise<string | null> {
    return this.db.value<string>(
      `SELECT "state"::text AS "value" FROM "sto_info_worker"."file_scan_attempt"
        WHERE "assetId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [assetId],
    );
  }

  /**
   * Waits for an import's rows to be in force: its file published and read.
   *
   * @param upload - The upload.
   * @param timeoutMs - How long to wait.
   * @returns How long it took.
   */
  async imported(upload: Upload, timeoutMs = 120_000): Promise<number> {
    const waited = await waitFor(
      `import ${upload.importId} to be read into rows`,
      async () => {
        const rows = await this.db.query<{
          state: string;
          observations: number;
        }>(
          `SELECT a."state"::text AS "state",
                  (SELECT count(*)::int FROM "sto_info_app"."fleet_roster_observation" o
                    WHERE o."importSourceId" = $2) AS "observations"
             FROM "sto_info_app"."file_asset" a WHERE a."id" = $1`,
          [upload.assetId, upload.importId],
        );

        return rows[0]?.state === 'AVAILABLE' && rows[0].observations > 0;
      },
      timeoutMs,
    );

    return waited.seconds;
  }

  /**
   * Counts published files no scanner cleared: the one number that must
   * always be nought.
   *
   * @returns How many.
   */
  async publishedUnscanned(): Promise<number> {
    return (
      (await this.db.value<number>(
        `SELECT count(*)::int AS "value" FROM "sto_info_app"."file_asset" a
          WHERE a."state" = 'AVAILABLE'
            AND NOT EXISTS (
              SELECT 1 FROM "sto_info_worker"."file_scan_attempt" s
               WHERE s."assetId" = a."id" AND s."state" = 'CLEAN')`,
      )) ?? 0
    );
  }

  /**
   * Checks nothing was published unscanned, as one line of the results.
   *
   * @param scenario - Which scenario.
   */
  async checkNothingUnscanned(scenario: string): Promise<void> {
    const count = await this.publishedUnscanned();

    this.results.check(
      scenario,
      'Nothing published without a clean scan',
      count === 0,
      null,
      `${count} published asset(s) without a CLEAN attempt`,
    );
  }

  /**
   * The open alert of a kind.
   *
   * @param kind - The kind.
   * @returns Its id, or null when none is open.
   */
  async openAlert(kind: string): Promise<string | null> {
    return this.db.value<string>(
      `SELECT "id"::text AS "value" FROM "sto_info_app"."operations_alert"
        WHERE "kind" = $1 AND "clearedAt" IS NULL`,
      [kind],
    );
  }

  /**
   * Waits for an alert to open.
   *
   * @param kind - The kind.
   * @returns Its id and how long it took.
   */
  async alertOpens(kind: string): Promise<{ id: string; seconds: number }> {
    const waited = await waitFor(
      `${kind} to open`,
      () => this.openAlert(kind),
      ALERT_TICK_MS,
      1_000,
    );

    return { id: waited.value, seconds: waited.seconds };
  }

  /**
   * Waits for an alert to clear.
   *
   * @param id - The alert.
   * @returns How long it took.
   */
  async alertClears(id: string): Promise<number> {
    const waited = await waitFor(
      `alert ${id} to clear`,
      () =>
        this.db.value<boolean>(
          `SELECT "clearedAt" IS NOT NULL AS "value" FROM "sto_info_app"."operations_alert" WHERE "id" = $1`,
          [id],
        ),
      ALERT_TICK_MS,
      1_000,
    );

    return waited.seconds;
  }

  /**
   * Lists failed jobs through the admin API.
   *
   * @param queue - One queue.
   * @returns The jobs.
   */
  async failedJobs(queue?: string): Promise<FailedJob[]> {
    const answer = await this.api.call<{ items?: FailedJob[] }>(
      'GET',
      `/admin/file-scanning/failed-jobs${queue === undefined ? '' : `?queue=${queue}`}`,
    );

    if (answer.status !== 200 || answer.body.items === undefined) {
      throw new Error(`Failed jobs answered ${answer.status}`);
    }

    return answer.body.items;
  }

  /**
   * Pauses or resumes publication through the admin API.
   *
   * @param action - Which.
   */
  async publication(action: 'pause' | 'resume'): Promise<void> {
    const answer = await this.api.call(
      'POST',
      `/admin/file-publication/${action}`,
      {
        reason: REASON,
      },
    );

    if (answer.status >= 300) {
      throw new Error(
        `Publication ${action} answered ${answer.status}: ${JSON.stringify(answer.body)}`,
      );
    }
  }

  /**
   * Runs a TypeORM command against a database with the built backend.
   *
   * @param command - `migration:run`, `migration:revert`.
   * @param database - Which database.
   * @param migrations - Which migrations, as a glob, when not all of them.
   * @returns Its exit code and output.
   */
  async backendMigrations(
    command: string,
    database: string,
    migrations?: string,
  ): Promise<{ code: number; output: string }> {
    const previous = this.databaseName;

    this.databaseName = database;

    try {
      const env = this.backendEnvironment();

      if (migrations !== undefined) {
        env.TYPEORM_MIGRATIONS = migrations;
      }

      const result = await runNode(
        join(this.config.repo, 'node_modules', 'typeorm', 'cli.js'),
        [
          command,
          '-d',
          join(this.config.work, 'backend', 'config', 'typeorm.datasource.js'),
        ],
        join(this.config.work, 'run-backend'),
        env,
      );

      writeFileSync(
        join(
          this.logs,
          `${String(++this._launches).padStart(2, '0')}-backend-${command.replace(':', '-')}-${database}.log`,
        ),
        result.output,
      );

      return result;
    } finally {
      this.databaseName = previous;
    }
  }

  /**
   * An asset's placement state.
   *
   * @param assetId - The asset.
   * @returns Its state, or null when it has none.
   */
  async placementState(assetId: string): Promise<string | null> {
    return this.db.value<string>(
      `SELECT "state"::text AS "value" FROM "sto_info_app"."file_asset_placement" WHERE "assetId" = $1`,
      [assetId],
    );
  }

  /**
   * Runs the nightly stale-upload sweep once, as the cron runs it:
   * `FileAssetUploadCleanupService.cleanup()`, in a process of its own that
   * builds the backend's module the way `main.ts` does before
   * `app.init()` — every provider, no route, no cron, no queue worker —
   * so it does not compete with the running backend.
   *
   * @returns What it logged, its summary line and how long it took.
   */
  async runSweep(): Promise<{ log: string; summary: string; seconds: number }> {
    const script = join(this.config.work, 'run-backend', 'sweep.js');

    writeFileSync(
      script,
      [
        "const { NestFactory } = require('@nestjs/core');",
        "const { AppModule } = require('src/app.module');",
        "const { FileAssetUploadCleanupService } = require('src/cron/jobs/file-asset-upload-cleanup/file-asset-upload-cleanup.service');",
        '(async () => {',
        "  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });",
        '  await app.get(FileAssetUploadCleanupService).cleanup();',
        '  process.exit(0);',
        '})().catch(error => {',
        '  console.error(error);',
        '  process.exit(1);',
        '});',
        '',
      ].join('\n'),
    );

    const started = Date.now();
    const result = await runNode(
      script,
      [],
      join(this.config.work, 'run-backend'),
      this.backendEnvironment(),
    );

    writeFileSync(
      join(
        this.logs,
        `${String(++this._launches).padStart(2, '0')}-backend-sweep.log`,
      ),
      result.output,
    );

    if (result.code !== 0) {
      throw new Error(`The sweep failed: ${failureOf(result.output)}`);
    }

    const summary =
      /(Kept every stale upload.*|Abandoned \d+ stale upload.*)/.exec(
        result.output,
      )?.[1] ?? 'no summary line';

    return {
      log: result.output,
      summary: summary.trim(),
      seconds: secondsSince(started),
    };
  }

  /**
   * Stops every process the rehearsal started.
   */
  async stopApps(): Promise<void> {
    await this.backend?.kill();
    await this.worker?.kill();
  }
}

/** A failed job, as the admin API lists it. */
interface FailedJob {
  readonly queue: string;
  readonly jobId: string;
  readonly name: string;
  readonly attemptsMade: number;
  readonly subjectId: string | null;
  readonly reason: string;
  readonly retryable: boolean;
  readonly notRetryableBecause: string | null;
}

/**
 * The lines of a command's output that say why it failed.
 *
 * @param output - What it printed.
 * @returns The first lines naming an error, or its last line.
 */
export function failureOf(output: string): string {
  const lines = output.split(/\r?\n/).filter(line => line.trim() !== '');
  const thrown = lines.filter(line =>
    /^\s*(\w*Error\b|error:)|refuses/i.test(line),
  );

  return (thrown.length > 0 ? thrown.slice(0, 3) : lines.slice(-2))
    .join(' / ')
    .slice(0, 600);
}

/**
 * Makes a small PNG of one colour: a picture that is really a picture, and
 * nobody's.
 *
 * @param red - Its red.
 * @param green - Its green.
 * @param blue - Its blue.
 * @returns The file.
 */
export function png(red: number, green: number, blue: number): Buffer {
  const size = 8;
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    const crc = Buffer.alloc(4);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);

    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));

    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);

  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;

  const row = Buffer.concat([
    Buffer.alloc(1),
    Buffer.from(Array.from({ length: size }, () => [red, green, blue]).flat()),
  ]);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk(
      'IDAT',
      deflateSync(Buffer.concat(Array.from({ length: size }, () => row))),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Runs one scenario, recording it as failed if it throws, so the next still
 * runs.
 *
 * @param r - The rehearsal.
 * @param name - The scenario.
 * @param body - What it does.
 */
export async function scenario(
  r: Rehearsal,
  name: string,
  body: () => Promise<void>,
): Promise<void> {
  console.log(`\n--- ${name} ---`);

  try {
    await r.ensureWhole();
    await body();
  } catch (error: unknown) {
    r.results.record(
      name,
      'Scenario stopped early',
      'FAIL',
      null,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Scenario 1: everything up from nothing.
 *
 * @param r - The rehearsal.
 */
export async function coldStart(r: Rehearsal): Promise<void> {
  const name = 'S1 Cold start';
  const { ports } = r.config;
  const started = Date.now();

  await r.containers.start('pg', 'redis', 'minio', 'clamd', 'aws');

  const waits: Array<[string, () => Promise<unknown>]> = [
    [
      'PostgreSQL accepting connections',
      () =>
        waitFor(
          'PostgreSQL',
          () => r.db.value<number>('SELECT 1 AS "value"'),
          120_000,
        ),
    ],
    [
      'Redis answering',
      () => waitFor('Redis', () => pingRedis(ports.redis), 60_000),
    ],
    [
      'MinIO ready',
      () =>
        waitFor(
          'MinIO',
          async () =>
            (
              await fetch(
                `http://127.0.0.1:${ports.minio}/minio/health/ready`,
              ).catch(() => null)
            )?.ok ?? false,
          120_000,
        ),
    ],
    [
      'Secrets Manager stand-in ready',
      () =>
        waitFor(
          'LocalStack',
          async () => {
            const response = await fetch(
              `http://127.0.0.1:${ports.aws}/_localstack/health`,
            ).catch(() => null);
            const body = (await response?.json().catch(() => null)) as {
              services?: Record<string, string>;
            } | null;

            return ['available', 'running'].includes(
              body?.services?.secretsmanager ?? '',
            );
          },
          180_000,
        ),
    ],
    [
      'clamd answering PING (signatures loaded)',
      () => waitFor('clamd', () => pingClamd(ports.clamd), 300_000),
    ],
  ];

  await Promise.all(
    waits.map(async ([step, wait]) => {
      await wait();
      r.results.record(
        name,
        step,
        'PASS',
        secondsSince(started),
        'from docker start',
      );
    }),
  );

  // PostgreSQL restarts once during its first initialisation; ask again.
  await waitFor(
    'PostgreSQL, settled',
    () => r.db.value<number>('SELECT 1 AS "value"'),
    60_000,
  );

  await seedSecret(r.config, r.secret);
  await createBuckets(r.config);

  // In two parts, with the site admin made in between. A migration from
  // 2025 (SeedStorytimeTags) records a site admin as the owner of the tags it
  // seeds and refuses to run without one, so an empty database cannot be
  // migrated in one go. The admin is made in SQL, with a password generated
  // for this run.
  let at = Date.now();
  let backendMigrations = await r.backendMigrations(
    'migration:run',
    DATABASES.main,
    BEFORE_STORYTIME_TAGS,
  );

  if (backendMigrations.code === 0) {
    await r.db.query(
      `INSERT INTO "sto_info_app"."user" ("id", "email", "password", "emailVerified", "role")
       VALUES ($1, $2, $3, true, 'ADMIN')`,
      [r.adminId, r.adminEmail, await bcrypt.hash(r.adminPassword, 10)],
    );
    await r.db.query(
      `INSERT INTO "sto_info_app"."user_profile" ("userId", "username", "firstName", "lastName")
       VALUES ($1, 'OpsRehearsalAdmin', 'Rehearsal', 'Admin')`,
      [r.adminId],
    );
    backendMigrations = await r.backendMigrations(
      'migration:run',
      DATABASES.main,
    );
  }

  if (
    !r.results.check(
      name,
      'Backend migrations applied to an empty database',
      backendMigrations.code === 0,
      secondsSince(at),
      backendMigrations.code === 0 ? '' : failureOf(backendMigrations.output),
    )
  ) {
    throw new Error('the backend migrations failed');
  }

  at = Date.now();
  const workerMigrations = await runNode(
    join(r.config.workerRepo, 'node_modules', 'typeorm', 'cli.js'),
    [
      'migration:run',
      '-d',
      join(r.config.work, 'worker', 'config', 'typeorm.datasource.js'),
    ],
    join(r.config.work, 'run-worker'),
    r.workerEnvironment(),
  );

  if (
    !r.results.check(
      name,
      'Worker migrations applied',
      workerMigrations.code === 0,
      secondsSince(at),
      workerMigrations.code === 0 ? '' : failureOf(workerMigrations.output),
    )
  ) {
    throw new Error('the worker migrations failed');
  }

  const appsStarted = Date.now();

  r.startBackend('cold-start');
  r.startWorker('cold-start');

  const [backendSeconds, worker] = await Promise.all([
    r.backendReady(),
    r.workerRunning(appsStarted),
  ]);

  r.results.record(
    name,
    'Backend /health/ready answers 200 (restore check included)',
    'PASS',
    backendSeconds,
    'from process start',
  );
  r.results.record(
    name,
    'Worker heartbeat RUNNING',
    'PASS',
    worker.seconds,
    'from process start',
  );
  r.results.record(
    name,
    'Whole stack ready',
    'INFO',
    secondsSince(started),
    'from docker start',
  );

  const log = r.backend?.log() ?? '';
  const check = log.indexOf('Restore check finished');
  const listening = log.indexOf('Nest application successfully started');

  r.results.check(
    name,
    'Restore check ran before the API listened',
    check !== -1 && listening !== -1 && check < listening,
    null,
    (
      /Restore check finished - (.*)/.exec(log)?.[1] ?? 'no summary line'
    ).trim(),
  );

  // The local fixture Community, seeded for the admin by the migration that
  // normally does it, which ran before they existed. After the first boot,
  // because the platforms its Fleets are on are made by the backend's
  // account seeder at startup, not by a migration.
  const windows = await r.db.value<number>(
    `SELECT count(*)::int AS "value" FROM "sto_info_app"."platform" WHERE "name" = 'Windows'`,
  );

  if (windows !== 1) {
    throw new Error('the backend did not seed the Windows platform at boot');
  }

  process.env.NODE_ENV = 'local';
  process.env.DATASEED_FLEET_OWNER_EMAIL = r.adminEmail;
  await new SeedLocalFleetFixtures1794000000000().up({
    query: (sql: string, params?: unknown[]) => r.db.query(sql, params),
  } as unknown as QueryRunner);

  await r.api.signIn(r.adminEmail, r.adminPassword);

  const upload = await r.uploadRoster();
  const seconds = await r.imported(upload);

  r.results.record(
    name,
    'First roster import, upload to rows in force',
    'PASS',
    seconds,
  );
  await r.checkNothingUnscanned(name);

  // A backup from before any site admin had done anything, for the rollback
  // scenario: the only kind of database the picture guard's own refusal can
  // still be reached on (see revertProbe).
  await r.containers.exec(
    'pg',
    'pg_dump -U postgres -Fc -f /tmp/baseline.dump rehearsal',
  );
}

/**
 * Scenario 2: the backend and then the worker killed while an upload is in
 * flight.
 *
 * @param r - The rehearsal.
 */
async function restartMidWork(r: Rehearsal): Promise<void> {
  const name = 'S2 Restart mid-work';

  // The backend dies the moment it has accepted an upload.
  const first = await r.uploadRoster();

  await r.backend?.kill();

  const scanned = await waitFor(
    'the worker to finish scanning with the backend down',
    async () => (await r.attemptState(first.assetId)) === 'CLEAN',
    120_000,
  );

  r.results.record(
    name,
    'Backend killed after 202; worker still scanned it',
    'PASS',
    scanned.seconds,
  );
  r.results.check(
    name,
    'Nothing published while the backend was down',
    (await r.assetState(first.assetId)) !== 'AVAILABLE',
    null,
    `asset ${await r.assetState(first.assetId)}`,
  );

  let restarted = Date.now();

  r.startBackend('after-kill');
  r.results.record(
    name,
    'Backend back to ready',
    'PASS',
    await r.backendReady(),
    'from restart',
  );

  const firstDone = await r.imported(first);

  r.results.record(
    name,
    'Upload in flight completed after the backend restart',
    'PASS',
    secondsSince(restarted),
    `ready + ${firstDone.toFixed(1)} s`,
  );

  // The worker dies mid-scan: clamd frozen so the scan hangs in its hands.
  await r.containers.pause('clamd');

  const second = await r.uploadRoster().catch(async (error: unknown) => {
    await r.containers.unpause('clamd');

    throw error;
  });

  try {
    const held = await waitFor(
      'the worker to claim the scan',
      async () =>
        ['CLAIMED', 'SCANNING'].includes(
          (await r.attemptState(second.assetId)) ?? '',
        ),
      60_000,
    );

    r.results.record(
      name,
      'Worker holds the scan (clamd frozen)',
      'INFO',
      held.seconds,
      `attempt ${await r.attemptState(second.assetId)}`,
    );
    await r.worker?.kill();
  } finally {
    await r.containers.unpause('clamd');
  }

  restarted = Date.now();
  r.startWorker('after-kill');

  const running = await r.workerRunning(restarted);

  r.results.record(
    name,
    'Worker back to RUNNING',
    'PASS',
    running.seconds,
    'from restart',
  );
  r.results.check(
    name,
    'Nothing published while the scan was abandoned',
    (await r.assetState(second.assetId)) !== 'AVAILABLE',
  );

  const secondDone = await r.imported(second, DEFAULT_SCAN_LEASE_MS + 180_000);

  r.results.record(
    name,
    'Scan abandoned by the crash completed after the worker restart',
    'PASS',
    secondsSince(restarted),
    `waits out the crashed worker's ${DEFAULT_SCAN_LEASE_MS / 60_000}-minute lease (SCAN_LEASE_MS); ${secondDone.toFixed(1)} s after RUNNING`,
  );

  const attempts = await r.db.value<number>(
    `SELECT count(*)::int AS "value" FROM "sto_info_worker"."file_scan_attempt" WHERE "assetId" = $1`,
    [second.assetId],
  );

  r.results.record(
    name,
    'Attempts recorded for the crashed scan',
    'INFO',
    null,
    String(attempts),
  );
  await r.checkNothingUnscanned(name);
}

/**
 * Scenario 3: Redis, clamd and the bucket each taken away.
 *
 * @param r - The rehearsal.
 */
async function outages(r: Rehearsal): Promise<void> {
  await scenario(r, 'S3a Redis outage', () => redisOutage(r));
  await scenario(r, 'S3b clamd outage', () => clamdOutage(r));
  await scenario(r, 'S3c Bucket outage at boot', () => bucketOutage(r));
}

/**
 * Redis stopped until `QUEUES_UNREACHABLE` opens: what still answers, what
 * waits, a pause thrown while it is away, and everything after it returns.
 *
 * @param r - The rehearsal.
 */
async function redisOutage(r: Rehearsal): Promise<void> {
  const name = 'S3a Redis outage';
  const stopped = Date.now();

  await r.containers.stop('redis');

  const ready = await r.api.ready();

  r.results.record(
    name,
    'Backend /health/ready during the outage',
    'INFO',
    null,
    ready ? '200 (it checks the database only)' : 'not 200',
  );

  // What a site admin opens first. Each should answer, with its Redis
  // figures missing, rather than wait for Redis.
  for (const [what, path] of [
    ['Scan Diagnostics', '/admin/file-scanning/diagnostics'],
    ['Failed-jobs list', '/admin/file-scanning/failed-jobs'],
    ['Publication switch', '/admin/file-publication'],
  ] as const) {
    const asked = Date.now();
    let outcome: string;
    let answered = false;

    try {
      const answer = await r.api.call('GET', path, undefined, 20_000);

      answered = [200, 503].includes(answer.status);
      outcome = `${answer.status} ${JSON.stringify(answer.body).slice(0, 120)}`;
    } catch (error: unknown) {
      outcome = `no answer: ${error instanceof Error ? error.message : String(error)}`;
    }

    const seconds = secondsSince(asked);

    r.results.check(
      name,
      `${what} answers within 6 s while Redis is away`,
      answered && seconds <= 6.5,
      seconds,
      outcome,
    );
  }

  // Thrown while the queue cannot be told: the switch is the authority.
  const pauseAsked = Date.now();
  let paused = false;
  let pauseOutcome: string;

  try {
    const answer = await r.api.call(
      'POST',
      '/admin/file-publication/pause',
      { reason: REASON },
      20_000,
    );

    paused = answer.status >= 200 && answer.status < 300;
    pauseOutcome = String(answer.status);
  } catch (error: unknown) {
    pauseOutcome = `no answer: ${error instanceof Error ? error.message : String(error)}`;
  }

  r.results.check(
    name,
    'Publication paused while Redis is away',
    paused,
    secondsSince(pauseAsked),
    pauseOutcome,
  );

  // The rate limiter's counts, which every request needs first, move to
  // memory while Redis cannot answer (src/common/http/fallback-rate-limit.store.ts).
  const toMemory = (r.backend?.log() ?? '').lastIndexOf(
    'Rate limits counted in memory while Redis cannot answer',
  );

  r.results.check(
    name,
    'Backend logs rate limits counted in memory during the outage',
    toMemory !== -1,
    null,
    toMemory === -1 ? 'not logged' : 'logged',
  );

  // Accepted now, queued later: the scan request gives Redis five seconds,
  // and the re-queue sweep sends it once Redis answers.
  let during: Upload | null = null;
  let uploadOutcome: string;
  const asked = Date.now();

  try {
    during = await r.uploadRoster(undefined, 30_000);
    uploadOutcome = `202; asset ${await r.assetState(during.assetId)}`;
  } catch (error: unknown) {
    uploadOutcome =
      error instanceof Error ? error.message.slice(0, 200) : String(error);
  }

  const uploadSeconds = secondsSince(asked);

  r.results.check(
    name,
    'Upload during the outage answers within about 6 s',
    during !== null && uploadSeconds <= 7,
    uploadSeconds,
    uploadOutcome,
  );

  const unreachable = await waitFor(
    'QUEUES_UNREACHABLE to open',
    () => r.openAlert('QUEUES_UNREACHABLE'),
    300_000,
    1_000,
  );

  r.results.record(
    name,
    'QUEUES_UNREACHABLE opens',
    'PASS',
    secondsSince(stopped),
    'from Redis stopping (threshold 2 minutes, judged each minute)',
  );
  r.results.check(
    name,
    'Backend and worker processes survived the outage',
    r.backend?.running === true && r.worker?.running === true,
  );

  // The restart case: the backend that accepted the upload goes before
  // Redis returns, so nothing it held in memory can be what queues it.
  await r.backend?.kill();

  const restarted = Date.now();

  r.startBackend('redis-down');

  let readyWhileAway = false;
  let restartOutcome: string;

  try {
    restartOutcome = `ready in ${await r.backendReady(90_000)} s`;
    readyWhileAway = true;
  } catch (error: unknown) {
    restartOutcome = `not ready within 90 s: ${error instanceof Error ? error.message : String(error)}`;
  }

  r.results.record(
    name,
    'Backend restarted while Redis is away',
    readyWhileAway ? 'PASS' : 'INFO',
    secondsSince(restarted),
    restartOutcome,
  );

  if (readyWhileAway) {
    // One request, so the new instance's rate limiter meets the outage too.
    const asked2 = Date.now();
    const answer = await r.api
      .call('GET', '/admin/file-publication', undefined, 20_000)
      .catch(() => null);

    r.results.check(
      name,
      'Publication switch answers from the restarted backend while Redis is away',
      answer !== null && answer.status === 200 && secondsSince(asked2) <= 6.5,
      secondsSince(asked2),
      answer === null ? 'no answer' : String(answer.status),
    );
  }

  const back = Date.now();

  await r.containers.start('redis');
  await waitFor('Redis', () => pingRedis(r.config.ports.redis), 60_000);
  r.results.record(
    name,
    'Redis back',
    'INFO',
    secondsSince(back),
    `down for ${secondsSince(stopped).toFixed(0)} s`,
  );

  if (!readyWhileAway) {
    r.results.record(
      name,
      'Restarted backend ready once Redis returned',
      'INFO',
      await r.backendReady(180_000),
      'from Redis start',
    );
  }

  // A request the outage held may still land now; the switch in the
  // database says what was decided.
  await sleep(5_000);

  const switchPaused =
    (await r.db.value<string>(
      `SELECT "value"::jsonb ->> 'paused' AS "value" FROM "sto_info_app"."app_setting" WHERE "key" = 'FILE_PUBLICATION_PAUSED'`,
    )) === 'true';

  if (switchPaused) {
    const queuePaused = await waitFor(
      'the publication queue to be paused to match the switch',
      () => queueIsPaused(r.config, 'file-asset-publication'),
      ALERT_TICK_MS,
      1_000,
    );

    r.results.record(
      name,
      'Publication queue paused once Redis returned',
      'PASS',
      queuePaused.seconds,
      'from Redis start',
    );
  }

  const cleared = await r.alertClears(unreachable.value);

  r.results.record(
    name,
    'QUEUES_UNREACHABLE clears',
    'PASS',
    secondsSince(back),
    `from Redis start (${cleared.toFixed(1)} s of waiting)`,
  );

  const after = await waitFor(
    'an upload to be accepted again',
    async () => {
      try {
        return await r.uploadRoster(undefined, 10_000);
      } catch {
        return null;
      }
    },
    180_000,
    2_000,
  );

  r.results.record(
    name,
    'Uploads accepted again',
    'PASS',
    secondsSince(back),
    'from Redis start',
  );

  const limiterLog = r.backend?.log() ?? '';
  const inMemory = limiterLog.lastIndexOf(
    'Rate limits counted in memory while Redis cannot answer',
  );
  const inRedis = limiterLog.lastIndexOf('Rate limits counted in Redis again');

  if (inMemory === -1) {
    r.results.record(
      name,
      'Backend logs rate limits counted in Redis again after it returns',
      'INFO',
      null,
      'the restarted backend counted nothing in memory, so there was nothing to switch back',
    );
  } else {
    r.results.check(
      name,
      'Backend logs rate limits counted in Redis again after it returns',
      inRedis !== -1 && inRedis > inMemory,
      null,
      inRedis === -1 ? 'not logged' : 'logged after the fall-back',
    );
  }

  if (switchPaused) {
    await r.publication('resume');
  }

  await r.imported(after.value);
  r.results.record(
    name,
    'Upload after the outage in force',
    'PASS',
    secondsSince(back),
    switchPaused
      ? 'from Redis start, publication resumed first'
      : 'from Redis start',
  );

  if (during !== null) {
    const queuedAgain = await r.imported(during, 300_000);

    r.results.record(
      name,
      'Upload made during the outage in force, the backend restarted in between',
      'PASS',
      secondsSince(back),
      `from Redis start (${queuedAgain.toFixed(1)} s of waiting)`,
    );

    const requeued = /\[requeue\] Scan requests queued again[^\n]*/.exec(
      r.backend?.log() ?? '',
    );

    r.results.check(
      name,
      'Backend logs the scan request queued again',
      requeued !== null,
      null,
      requeued?.[0].trim() ?? 'not logged',
    );
  }

  // Every upload that reached the backend during the outage, whether or not
  // its client waited for the answer: each must end in force, never
  // half-done.
  const reached = await r.db.query<{ id: string; assetId: string }>(
    `SELECT "id"::text AS "id", "assetId"::text AS "assetId"
       FROM "sto_info_app"."fleet_roster_import_source"
      WHERE "createdAt" >= to_timestamp($1) AND "assetId" <> $2`,
    [(stopped - 5_000) / 1000, after.value.assetId],
  );
  const stuck: string[] = [];

  for (const row of reached) {
    try {
      await r.imported({ importId: row.id, assetId: row.assetId }, 60_000);
    } catch {
      stuck.push(
        `${row.assetId.slice(0, 8)} ${await r.assetState(row.assetId)}`,
      );
    }
  }

  r.results.check(
    name,
    'Uploads that reached the backend during the outage completed',
    stuck.length === 0,
    secondsSince(back),
    `${reached.length} reached it (${during === null ? 'its client gave up waiting' : 'answered 202'}); ` +
      (stuck.length === 0 ? 'all in force' : `stuck: ${stuck.join(', ')}`),
  );

  const beating = await r.db.value<boolean>(
    `SELECT true AS "value" FROM "sto_info_worker"."worker_heartbeat_status"
      WHERE "state" = 'RUNNING' AND "beatAt" > now() - interval '1 minute' LIMIT 1`,
  );

  r.results.check(
    name,
    'Worker heartbeat RUNNING after the outage',
    beating === true,
  );
  await r.checkNothingUnscanned(name);
}

/**
 * clamd stopped: the worker pauses, jobs wait, and the alert opens once the
 * pause is old enough.
 *
 * @param r - The rehearsal.
 */
async function clamdOutage(r: Rehearsal): Promise<void> {
  const name = 'S3b clamd outage';
  const stopped = Date.now();

  await r.containers.stop('clamd');

  const paused = await waitFor(
    'the worker heartbeat to say PAUSED',
    async () => {
      const rows = await r.db.query<{
        workerId: string;
        pauseReason: string | null;
      }>(
        `SELECT "workerId", "pauseReason" FROM "sto_info_worker"."worker_heartbeat_status"
          WHERE "state" = 'PAUSED' AND "beatAt" > now() - interval '2 minutes'`,
      );

      return rows[0] ?? null;
    },
    180_000,
    1_000,
  );

  r.results.check(
    name,
    'Worker heartbeat PAUSED, with a reason',
    paused.value.pauseReason !== null,
    paused.seconds,
    `pauseReason ${paused.value.pauseReason}`,
  );

  const upload = await r.uploadRoster();

  await sleep(45_000);

  const state = await r.assetState(upload.assetId);
  const failedScans = await r.failedJobs('file-scan');

  r.results.check(
    name,
    'Upload waits while the scanner is away (none fail)',
    state === 'SCANNING' && failedScans.length === 0,
    null,
    `asset ${state}, ${failedScans.length} failed scan job(s)`,
  );

  // The alert opens after ten minutes of pause; age the pause rather than
  // wait for it, and leave the thresholds as the code has them.
  await r.db.query(
    `UPDATE "sto_info_worker"."worker_heartbeat"
        SET "pausedSince" = now() - interval '11 minutes'
      WHERE "workerId" = $1 AND "state" = 'PAUSED'`,
    [paused.value.workerId],
  );

  const alert = await r.alertOpens('WORKER_PAUSED');

  r.results.record(
    name,
    'WORKER_PAUSED opens (pause aged past 10 minutes)',
    'PASS',
    alert.seconds,
    'from ageing the row',
  );

  const notified = await r.db.value<number>(
    `SELECT count(*)::int AS "value" FROM "sto_info_app"."notification"
      WHERE "createdAt" >= to_timestamp($1)`,
    [(Date.now() - alert.seconds * 1000 - 5_000) / 1000],
  );

  r.results.record(
    name,
    'In-app notifications written for the site admin',
    notified !== null && notified > 0 ? 'PASS' : 'FAIL',
    null,
    `${notified} notification(s)`,
  );

  const back = Date.now();

  await r.containers.start('clamd');
  await waitFor('clamd', () => pingClamd(r.config.ports.clamd), 300_000);
  r.results.record(
    name,
    'clamd back (signatures loaded)',
    'INFO',
    secondsSince(back),
    `down for ${secondsSince(stopped).toFixed(0)} s`,
  );

  await waitFor(
    'the heartbeat to say RUNNING',
    () =>
      r.db.value<boolean>(
        `SELECT true AS "value" FROM "sto_info_worker"."worker_heartbeat_status"
          WHERE "workerId" = $1 AND "state" = 'RUNNING'`,
        [paused.value.workerId],
      ),
    180_000,
    1_000,
  );
  r.results.record(
    name,
    'Worker heartbeat RUNNING again',
    'PASS',
    secondsSince(back),
    'from clamd start',
  );

  await r.imported(upload, 240_000);
  r.results.record(
    name,
    'Waiting upload in force',
    'PASS',
    secondsSince(back),
    'from clamd start',
  );

  const cleared = await r.alertClears(alert.id);

  r.results.record(
    name,
    'WORKER_PAUSED clears',
    'PASS',
    secondsSince(back),
    `${cleared.toFixed(1)} s after the upload`,
  );
  await r.checkNothingUnscanned(name);
}

/**
 * The bucket gone when the backend starts: it must not serve until it can
 * read the ledgers.
 *
 * @param r - The rehearsal.
 */
async function bucketOutage(r: Rehearsal): Promise<void> {
  const name = 'S3c Bucket outage at boot';

  await r.backend?.kill();
  await r.containers.stop('minio');

  const started = Date.now();

  r.startBackend('bucket-down');

  let answered = false;

  while (Date.now() - started < 60_000) {
    answered ||= await r.api.ready();
    await sleep(1_000);
  }

  const log = r.backend?.log() ?? '';
  const retries = (log.match(/Restore check failed/g) ?? []).length;

  r.results.check(
    name,
    'Backend serves nothing while the bucket is away (60 s watched)',
    !answered && r.backend?.running === true && retries > 0,
    null,
    `/health/ready ${answered ? 'answered' : 'never answered'}, ${retries} failed restore check(s) logged`,
  );

  const back = Date.now();

  await r.containers.start('minio');

  const ready = await r.backendReady(180_000);

  r.results.record(
    name,
    'Backend ready once the bucket returned',
    'PASS',
    ready,
    `from MinIO start; ${secondsSince(started).toFixed(1)} s from process start`,
  );
  r.results.record(
    name,
    'Restore check attempts before it succeeded',
    'INFO',
    null,
    String((r.backend?.log().match(/Restore check failed/g) ?? []).length),
  );
  r.results.record(
    name,
    'Whole outage, process start to ready',
    'INFO',
    secondsSince(started),
    `MinIO was away for ${((back - started) / 1000).toFixed(0)} s of it`,
  );
}

/**
 * Scenario 4: a backup taken, then an erasure, a hold and a deny, then the
 * backup restored.
 *
 * @param r - The rehearsal.
 */
async function restore(r: Rehearsal): Promise<void> {
  const name = 'S4 Restore';

  // So nothing scans the two pictures below: the first must still be
  // waiting when the backup is taken, and neither may ever be published.
  await r.worker?.kill();

  const pictureA = await r.api.upload<{ assetId?: string }>(
    '/user/update-profile-pic',
    'profilePicture',
    'rehearsal-a.png',
    png(200, 40, 40),
    'image/png',
  );
  const assetA = pictureA.body.assetId;

  if (pictureA.status !== 202 || assetA === undefined) {
    throw new Error(
      `The first picture answered ${pictureA.status}: ${JSON.stringify(pictureA.body).slice(0, 300)}`,
    );
  }

  // A member who will close their own account after the backup, made in
  // SQL with a password generated for this run.
  const member = {
    id: randomUUID(),
    email: 'ops-rehearsal-member@rehearsal.example',
    password: generated(18),
  };

  await r.db.query(
    `INSERT INTO "sto_info_app"."user" ("id", "email", "password", "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [member.id, member.email, await bcrypt.hash(member.password, 10)],
  );
  await r.db.query(
    `INSERT INTO "sto_info_app"."user_profile" ("userId", "username", "firstName", "lastName")
     VALUES ($1, 'OpsRehearsalMember', 'Rehearsal', 'Member')`,
    [member.id],
  );

  let at = Date.now();

  await r.containers.exec(
    'pg',
    'pg_dump -U postgres -Fc -f /tmp/rehearsal.dump rehearsal',
  );
  r.results.record(
    name,
    'pg_dump taken',
    'PASS',
    secondsSince(at),
    `${await r.containers.exec('pg', 'wc -c < /tmp/rehearsal.dump')} bytes`,
  );

  // A later upload for the same slot abandons the first: denied, DELETED.
  const pictureB = await r.api.upload(
    '/user/update-profile-pic',
    'profilePicture',
    'rehearsal-b.png',
    png(40, 40, 200),
    'image/png',
  );

  r.results.check(
    name,
    'Second picture accepted',
    pictureB.status === 202,
    null,
    String(pictureB.status),
  );

  const denied = await waitFor(
    'the first picture to be denied',
    async () => (await r.assetState(assetA)) === 'DELETED',
    30_000,
  );

  r.results.record(
    name,
    'Deny made after the backup (superseded upload DELETED)',
    'PASS',
    denied.seconds,
  );

  const erasure = await r.api.call<{ id?: string }>(
    'POST',
    '/admin/roster-erasures',
    {
      ...ERASED_IN_RESTORE,
      reason: REASON,
    },
  );

  r.results.check(
    name,
    'Erasure made after the backup',
    erasure.status >= 200 && erasure.status < 300,
    null,
    String(erasure.status),
  );

  const applicantId = await r.db.value<string>(
    `SELECT "id"::text AS "value" FROM "sto_info_app"."user" WHERE "email" = $1`,
    [r.applicantEmail],
  );
  const hold = await r.api.call<{ id?: string }>(
    'POST',
    '/admin/moderation-holds',
    {
      kind: 'MEMBER_MESSAGES',
      subjectUserId: applicantId,
      reason: REASON,
    },
  );

  r.results.check(
    name,
    'Moderation hold placed after the backup',
    hold.status >= 200 && hold.status < 300 && hold.body.id !== undefined,
    null,
    String(hold.status),
  );

  const memberApi = new Api(r.config.ports.backend);

  await memberApi.signIn(member.email, member.password);

  const closure = await memberApi.call('DELETE', '/user/close-account');
  const closedAt = await r.db.value<string>(
    `SELECT to_char("deletedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "value" FROM "sto_info_app"."user" WHERE "id" = $1`,
    [member.id],
  );

  r.results.check(
    name,
    'Member closed their account after the backup',
    closure.status === 200 && closedAt !== null,
    null,
    `${closure.status}; deletedAt ${closedAt}`,
  );

  await r.backend?.kill();

  at = Date.now();
  await r.containers.exec(
    'pg',
    `createdb -U postgres ${DATABASES.restored} && pg_restore -U postgres --exit-on-error -d ${DATABASES.restored} /tmp/rehearsal.dump`,
  );
  r.results.record(
    name,
    'Backup restored into a fresh database',
    'PASS',
    secondsSince(at),
  );

  await r.useDatabase(DATABASES.restored);

  const before = {
    asset: await r.assetState(assetA),
    erasures: await r.db.value<number>(
      `SELECT count(*)::int AS "value" FROM "sto_info_app"."roster_erasure"`,
    ),
    hold: await r.db.value<number>(
      `SELECT count(*)::int AS "value" FROM "sto_info_app"."moderation_hold" WHERE "id" = $1`,
      [hold.body.id],
    ),
    memberOpen: await r.db.value<boolean>(
      `SELECT "deletedAt" IS NULL AS "value" FROM "sto_info_app"."user" WHERE "id" = $1`,
      [member.id],
    ),
  };

  r.results.record(
    name,
    'Restored database predates all four',
    'INFO',
    null,
    `asset ${before.asset}, ${before.erasures} erasure(s), hold rows ${before.hold}, ` +
      `member account ${before.memberOpen === true ? 'open' : 'closed'}`,
  );

  at = Date.now();
  r.startBackend('restored');

  const ready = await r.backendReady();

  r.results.record(
    name,
    'Backend ready on the restored database',
    'PASS',
    ready,
    'restore check included',
  );

  const log = r.backend?.log() ?? '';
  const summary = /Restore check finished - (.*)/.exec(log)?.[1]?.trim() ?? '';
  const check = log.indexOf('Restore check finished');
  const listening = log.indexOf('Nest application successfully started');

  r.results.check(
    name,
    'Ledgers replayed before the API listened',
    check !== -1 && check < listening,
    null,
    summary,
  );

  const timings =
    /ListMs: (\d+), CompareMs: (\d+), ReplayMs: (\d+), BackfillMs: (\d+)/.exec(
      summary,
    );

  if (timings !== null) {
    r.results.record(
      name,
      'Restore check: list / compare / replay / backfill',
      'INFO',
      null,
      `${timings[1]} / ${timings[2]} / ${timings[3]} / ${timings[4]} ms`,
    );
  }

  const replayedErasure = await r.db.value<boolean>(
    `SELECT true AS "value" FROM "sto_info_app"."roster_erasure" WHERE "replayed" = true`,
  );
  const stillNamed = await r.db.value<number>(
    `SELECT count(*)::int AS "value" FROM "sto_info_app"."fleet_roster_observation"
      WHERE "characterName" = $1 AND "accountHandle" = $2`,
    [ERASED_IN_RESTORE.characterName, ERASED_IN_RESTORE.accountHandle],
  );

  r.results.check(
    name,
    'Erasure brought back',
    replayedErasure === true && stillNamed === 0,
    null,
    `${stillNamed} row(s) still naming them`,
  );

  const holdReason = await r.db.value<string>(
    `SELECT "reason" AS "value" FROM "sto_info_app"."moderation_hold" WHERE "id" = $1`,
    [hold.body.id],
  );

  r.results.check(
    name,
    'Moderation hold brought back',
    holdReason === HOLD_REPLAYED_REASON,
    null,
    holdReason === null ? 'missing' : 'with the replayed reason',
  );

  const assetAfter = await r.assetState(assetA);

  r.results.check(
    name,
    'Deny brought back',
    assetAfter === 'DELETED',
    null,
    `asset ${assetAfter}`,
  );

  const closedAgainAt = await r.db.value<string>(
    `SELECT to_char("deletedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "value" FROM "sto_info_app"."user" WHERE "id" = $1`,
    [member.id],
  );

  // The ledger is written before the database, so the date it brings back
  // is the ledger's, a few milliseconds before the closure's own, and to the
  // millisecond. Within a second is its original date for the retention
  // clock that runs from it; the difference is reported.
  const drift =
    closedAgainAt === null || closedAt === null
      ? null
      : Date.parse(`${closedAgainAt}Z`) - Date.parse(`${closedAt}Z`);

  r.results.check(
    name,
    'Account closure brought back, with its original date',
    drift !== null && Math.abs(drift) < 1_000,
    null,
    `deletedAt ${closedAgainAt ?? 'none: the account is open'}, first closed ${closedAt}` +
      (drift === null ? '' : ` (${drift} ms apart)`),
  );

  const reconciled = await r.db.value<string>(
    `SELECT "reason" AS "value" FROM "sto_info_app"."site_admin_action"
      WHERE "action" = 'LEDGERS_RECONCILED' ORDER BY "createdAt" DESC LIMIT 1`,
  );

  r.results.check(
    name,
    'LEDGERS_RECONCILED in the site admin log',
    reconciled !== null,
    null,
    reconciled ?? 'missing',
  );
  r.results.record(
    name,
    'Restore to serving, end to end',
    'INFO',
    secondsSince(at),
    'backend start to ready on the restored database',
  );

  const since = Date.now();

  r.startWorker('restored');
  await r.workerRunning(since);

  // The two pictures' scan requests are still in Redis, which the restore
  // did not touch. Whatever the worker makes of them, neither is published.
  await sleep(20_000);

  const pictures = await r.db.value<number>(
    `SELECT count(*)::int AS "value" FROM "sto_info_app"."file_asset"
      WHERE "kind" = 'PROFILE_IMAGE' AND "state" = 'AVAILABLE'`,
  );

  r.results.check(
    name,
    'Neither picture published after the restore',
    pictures === 0,
    null,
    `${pictures} published`,
  );
  const cloudflare = r.egress
    .attemptsSince()
    .filter(target => target.includes('cloudflare'));

  r.results.check(
    name,
    'Nothing tried to reach Cloudflare',
    cloudflare.length === 0,
    null,
    cloudflare.join(', ') || 'no attempt',
  );
  await r.checkNothingUnscanned(name);
}

/**
 * Scenario 5: the ways back to an older release, and what stops each one
 * bringing back the upload bypass.
 *
 * @param r - The rehearsal.
 */
async function rollback(r: Rehearsal): Promise<void> {
  const name = 'S5 Rollback';

  await revertProbe(r, name);

  // What the pre-FC-012 upload path did: write a fresh Cloudflare identifier
  // straight into a picture column.
  let refusal: string | null = null;

  try {
    await r.db.query(
      `UPDATE "sto_info_app"."user_profile" SET "profilePictureId" = $1 WHERE "userId" = $2`,
      [`ops-rehearsal-unscanned-${randomUUID()}`, r.adminId],
    );
  } catch (error: unknown) {
    refusal = sqlState(error);
  }

  r.results.check(
    name,
    'Direct write of an unpublished picture reference refused',
    refusal === PUBLISHED_IMAGE_GUARD_SQLSTATE,
    null,
    `SQLSTATE ${refusal ?? 'none: the write was accepted'}`,
  );

  const keys = await secretKeys(r.config);
  const oldKeys = OLD_CLOUDFLARE_SECRET_KEYS.filter(key => keys.includes(key));
  const newKeys = GATED_CLOUDFLARE_SECRET_KEYS.filter(key =>
    keys.includes(key),
  );

  r.results.check(
    name,
    'Secret holds only the new Cloudflare key names',
    oldKeys.length === 0 &&
      newKeys.length === GATED_CLOUDFLARE_SECRET_KEYS.length,
    null,
    `old names present: ${oldKeys.join(', ') || 'none'}`,
  );

  // Pause, go back to the older release, come forward again, resume.
  await r.publication('pause');

  const held = await r.uploadRoster();
  const scanned = await waitFor(
    'the held upload to be scanned',
    async () => (await r.attemptState(held.assetId)) === 'CLEAN',
    120_000,
  );

  await sleep(5_000);
  r.results.check(
    name,
    'Upload scanned and held while publication is paused',
    (await r.assetState(held.assetId)) === 'CLEAN',
    scanned.seconds,
    `asset ${await r.assetState(held.assetId)}`,
  );

  await r.backend?.kill();

  if (r.config.oldBackendMain === null) {
    r.results.record(
      name,
      `Boot ${r.config.oldBackendRef}`,
      'INFO',
      null,
      `skipped: ${r.config.oldBackendSkipped ?? 'not built'}`,
    );
  } else {
    await oldRelease(r, name, r.config.oldBackendMain);
  }

  r.results.check(
    name,
    'Held upload still unpublished after the rollback',
    (await r.assetState(held.assetId)) !== 'AVAILABLE',
  );

  const forward = Date.now();

  r.startBackend('roll-forward');
  await r.backendReady();
  r.results.record(
    name,
    'Current release back (roll forward)',
    'PASS',
    secondsSince(forward),
  );
  await sleep(10_000);
  r.results.check(
    name,
    'Pause survived the rollback and roll forward',
    (await r.assetState(held.assetId)) === 'CLEAN',
  );

  const resumed = Date.now();

  await r.publication('resume');
  await r.imported(held);
  r.results.record(
    name,
    'Held upload published after resume',
    'PASS',
    secondsSince(resumed),
    'from resume',
  );
  await r.checkNothingUnscanned(name);
}

/**
 * `migration:revert`, step by step, on copies of the rehearsal database.
 *
 * Two copies, because what stops a rollback depends on what the database
 * has seen. A copy of today's database holds FC-042's Security Log entries,
 * so the operations migration refuses before the picture guard is reached.
 * The guard's own refusal is shown on a copy of the backup taken at the end
 * of the cold start, before any site admin had done anything.
 *
 * @param r - The rehearsal.
 * @param name - The scenario.
 */
async function revertProbe(r: Rehearsal, name: string): Promise<void> {
  const probe = DATABASES.probe;
  const db = new Database(r.config, probe);

  await r.containers.exec(
    'pg',
    `pg_dump -U postgres -Fc -f /tmp/probe.dump ${r.databaseName} && createdb -U postgres ${probe} && pg_restore -U postgres --exit-on-error -d ${probe} /tmp/probe.dump`,
  );

  try {
    await db.query(
      `UPDATE "sto_info_app"."app_setting" SET "value" = $1 WHERE "key" = 'FILE_PUBLICATION_PAUSED'`,
      [
        JSON.stringify({
          paused: true,
          pausedAt: new Date().toISOString(),
          pausedByUserId: r.adminId,
        }),
      ],
    );

    let reverted = await r.backendMigrations('migration:revert', probe);

    r.results.check(
      name,
      "Today's copy: migration:revert refused while publication is paused",
      reverted.code !== 0 && reverted.output.includes('Publication is paused'),
      null,
      reverted.code === 0 ? 'it reverted' : failureOf(reverted.output),
    );

    await db.query(
      `UPDATE "sto_info_app"."app_setting" SET "value" = '{"paused":false}' WHERE "key" = 'FILE_PUBLICATION_PAUSED'`,
    );

    const logged = await db.value<number>(
      `SELECT count(*)::int AS "value" FROM "sto_info_app"."site_admin_action" WHERE "action"::text = ANY($1)`,
      [[...OPERATIONS_ACTIONS]],
    );

    reverted = await r.backendMigrations('migration:revert', probe);
    r.results.check(
      name,
      "Today's copy: migration:revert of 1797500000000 refused once the Security Log holds its actions",
      reverted.code !== 0 &&
        reverted.output.includes('The Security Log holds operations actions'),
      null,
      `${logged} such entr${logged === 1 ? 'y' : 'ies'}; ` +
        (reverted.code === 0 ? 'it reverted' : failureOf(reverted.output)),
    );

    // The guard's down stops any revert before 1797200000000 is reached, so
    // that migration's own refusal is asked for directly, in a transaction
    // that is rolled back whatever happens.
    const reconciled = await db.value<number>(
      `SELECT count(*)::int AS "value" FROM "sto_info_app"."site_admin_action" WHERE "action" = 'LEDGERS_RECONCILED'`,
    );
    const seen: { refusal: string | null } = { refusal: null };

    await db.inRolledBackTransaction(async runner => {
      try {
        await new RecordLedgerReconciliation1797200000000().down(runner);
      } catch (error: unknown) {
        seen.refusal = error instanceof Error ? error.message : String(error);
      }
    });

    r.results.check(
      name,
      "Today's copy: 1797200000000's down refused once LEDGERS_RECONCILED is logged",
      seen.refusal !== null &&
        seen.refusal.includes(LEDGER_ACTIONS_DOWN_REFUSAL),
      null,
      `${reconciled} LEDGERS_RECONCILED entr${reconciled === 1 ? 'y' : 'ies'}; ` +
        `down called directly: ${seen.refusal ?? 'it did not refuse'}`,
    );
  } finally {
    await db.close();
    await r.containers
      .exec('pg', `dropdb -U postgres --if-exists ${probe}`)
      .catch(() => undefined);
  }

  const clean = new Database(r.config, probe);

  await r.containers.exec(
    'pg',
    `createdb -U postgres ${probe} && pg_restore -U postgres --exit-on-error -d ${probe} /tmp/baseline.dump`,
  );

  try {
    const logged = await clean.value<number>(
      `SELECT count(*)::int AS "value" FROM "sto_info_app"."site_admin_action" WHERE "action"::text = ANY($1)`,
      [[...OPERATIONS_ACTIONS, 'LEDGERS_RECONCILED']],
    );
    let reverted = await r.backendMigrations('migration:revert', probe);

    r.results.check(
      name,
      'Cold-start copy: migration:revert of 1797500000000 with nothing logged',
      reverted.code === 0,
      null,
      `${logged} FC-042 Security Log entries; ` +
        (reverted.code === 0 ? 'reverted' : failureOf(reverted.output)),
    );

    reverted = await r.backendMigrations('migration:revert', probe);
    r.results.check(
      name,
      'Cold-start copy: migration:revert below 1797300000000 refused',
      reverted.code !== 0 &&
        reverted.output.includes(
          PUBLISHED_IMAGE_GUARD_DOWN_REFUSAL.slice(0, 60),
        ),
      null,
      reverted.code === 0
        ? 'the guard was removed'
        : 'refused: roll forward instead',
    );

    const forward = await r.backendMigrations('migration:run', probe);

    r.results.check(
      name,
      'Cold-start copy: migration:run brings it forward again',
      forward.code === 0,
    );
  } finally {
    await clean.close();
    await r.containers
      .exec('pg', `dropdb -U postgres --if-exists ${probe}`)
      .catch(() => undefined);
  }
}

/**
 * Boots the older release against the rehearsal's database, as a Render
 * rollback would, and tries its upload path.
 *
 * @param r - The rehearsal.
 * @param name - The scenario.
 * @param main - Its entry point.
 */
async function oldRelease(
  r: Rehearsal,
  name: string,
  main: string,
): Promise<void> {
  const since = Date.now();
  const before = await r.db.value<string | null>(
    `SELECT "profilePictureId" AS "value" FROM "sto_info_app"."user_profile" WHERE "userId" = $1`,
    [r.adminId],
  );

  r.oldReleaseWindow = [since, Number.MAX_SAFE_INTEGER];
  r.startBackend('old-release', main);

  // With the retired names gone from the secret it should not get far. If
  // it does start, its synchronous upload path is tried below.
  try {
    const ready = await r.backendReady(180_000);

    r.results.record(
      name,
      `${r.config.oldBackendRef} starts on today's database`,
      'INFO',
      ready,
      'although the secret lacks every Cloudflare name it reads',
    );
  } catch (error: unknown) {
    const refusal = /(Missing Cloudflare.*)/.exec(r.backend?.log() ?? '');

    r.results.check(
      name,
      `${r.config.oldBackendRef} cannot start with the retired secret names gone`,
      refusal !== null && r.backend?.running === false,
      secondsSince(since),
      refusal?.[1].trim() ??
        `it failed otherwise: ${error instanceof Error ? error.message : String(error)}`,
    );
    await r.backend?.kill();
    r.oldReleaseWindow = [since, Date.now()];

    return;
  }

  const old = new Api(r.config.ports.backend);

  await old.signIn(r.adminEmail, r.adminPassword);

  const upload = await old.upload(
    '/user/update-profile-pic',
    'profilePicture',
    'rehearsal-old.png',
    png(40, 200, 40),
    'image/png',
    {},
    120_000,
  );
  const after = await r.db.value<string | null>(
    `SELECT "profilePictureId" AS "value" FROM "sto_info_app"."user_profile" WHERE "userId" = $1`,
    [r.adminId],
  );
  const attempts = r.egress.attemptsSince(since);
  const log = r.backend?.log() ?? '';
  const guard = log.includes(PUBLISHED_IMAGE_GUARD_SQLSTATE);

  r.results.check(
    name,
    `${r.config.oldBackendRef}'s synchronous picture upload publishes nothing`,
    upload.status >= 400 && after === before,
    null,
    `answered ${upload.status}; picture column ${after === before ? 'unchanged' : 'CHANGED'}; ` +
      `outbound attempts refused: ${attempts.join(', ') || 'none'}${guard ? '; IRG01 logged' : ''}`,
  );
  await r.backend?.kill();
  r.oldReleaseWindow = [since, Date.now()];
}

/**
 * Scenario 6: a publication that runs out of attempts because the bucket
 * is away, retried once it is back; and the scan job the restore left
 * behind, which a retry cannot help, refused and discarded.
 *
 * The earlier version also failed a scan job by stopping PostgreSQL while
 * the worker held it. It was dropped once publication failures became real
 * failed jobs: it cost five minutes of lease for the same retry path.
 *
 * @param r - The rehearsal.
 */
async function failedJobs(r: Rehearsal): Promise<void> {
  const name = 'S6 Failed-job recovery';
  const minioReady = async () =>
    (
      await fetch(
        `http://127.0.0.1:${r.config.ports.minio}/minio/health/ready`,
      ).catch(() => null)
    )?.ok ?? false;

  // The bucket goes away just as a held upload is released for publication.
  await r.publication('pause');

  const upload = await r.uploadRoster();

  await waitFor(
    'the upload to be scanned and held',
    async () => (await r.assetState(upload.assetId)) === 'CLEAN',
    120_000,
  );
  await r.containers.stop('minio');

  const resumed = Date.now();

  try {
    await r.publication('resume');

    const failed = await waitFor(
      'the publication job to run out of attempts',
      async () =>
        ((await failedJobCounts(r.config))['file-asset-publication'] ?? 0) > 0,
      300_000,
      1_000,
    );

    r.results.record(
      name,
      'Publication ran out of attempts with the bucket away',
      'PASS',
      failed.seconds,
      'from resume (5 attempts, backoff from 5 s)',
    );
  } finally {
    await r.containers.start('minio');
  }

  await waitFor('MinIO', minioReady, 120_000);

  const alert = await r.alertOpens('FAILED_JOBS');

  r.results.record(
    name,
    'FAILED_JOBS open',
    'PASS',
    secondsSince(resumed),
    'from resume',
  );
  r.results.check(
    name,
    'The upload waits, unpublished',
    (await r.assetState(upload.assetId)) === 'CLEAN',
    null,
    `asset ${await r.assetState(upload.assetId)}`,
  );

  const listed = await r.failedJobs();

  for (const job of listed) {
    r.results.record(
      name,
      'Listed failed job',
      'INFO',
      null,
      `${job.queue} ${job.name}: ${job.reason}, ${job.attemptsMade} attempts, ` +
        `retryable ${job.retryable}` +
        (job.notRetryableBecause === null
          ? ''
          : ` (${job.notRetryableBecause})`),
    );
  }

  const ours = listed.find(
    job =>
      job.queue === 'file-asset-publication' && job.jobId === upload.assetId,
  );

  if (
    !r.results.check(
      name,
      'The failed publication is listed as retryable',
      ours?.retryable === true,
      null,
      ours === undefined ? 'not listed' : `reason ${ours.reason}`,
    ) ||
    ours === undefined
  ) {
    return;
  }

  const retriedAt = Date.now();
  const retry = await r.api.call(
    'POST',
    `/admin/file-scanning/failed-jobs/file-asset-publication/${encodeURIComponent(ours.jobId)}/retry`,
    { reason: REASON },
  );

  r.results.check(
    name,
    'Retry with a reason accepted',
    retry.status >= 200 && retry.status < 300,
    null,
    String(retry.status),
  );
  await r.imported(upload);
  r.results.record(
    name,
    'Retried publication completed',
    'PASS',
    secondsSince(retriedAt),
    'from the retry',
  );

  const unretryable = listed.filter(job => !job.retryable);

  if (unretryable.length === 0) {
    r.results.record(
      name,
      'Discard of a job a retry cannot help',
      'INFO',
      null,
      'none was listed, so discard was not exercised',
    );
  } else {
    const [first] = unretryable;
    const path = `/admin/file-scanning/failed-jobs/${first.queue}/${encodeURIComponent(first.jobId)}`;
    const refused = await r.api.call('POST', `${path}/retry`, {
      reason: REASON,
    });

    r.results.check(
      name,
      'Retrying a job a retry cannot help is refused',
      refused.status === 409,
      null,
      String(refused.status),
    );

    const discardedAt = Date.now();
    const discard = await r.api.call('POST', `${path}/discard`, {
      reason: REASON,
    });

    r.results.check(
      name,
      'Discard with a reason accepted',
      discard.status >= 200 && discard.status < 300,
      secondsSince(discardedAt),
      `${first.queue} ${first.notRetryableBecause}; ${discard.status}`,
    );

    if (unretryable.length > 1) {
      await r.api.call(
        'POST',
        '/admin/file-scanning/failed-jobs/discard-unretryable',
        { reason: REASON },
      );
    }
  }

  await waitFor(
    'no failed job to be left',
    async () => Object.keys(await failedJobCounts(r.config)).length === 0,
    120_000,
    1_000,
  );

  const cleared = await r.alertClears(alert.id);

  r.results.record(
    name,
    'FAILED_JOBS clears',
    'PASS',
    cleared,
    'from the last failed job going',
  );

  const logged = await r.db.query<{ action: string; count: number }>(
    `SELECT "action"::text AS "action", count(*)::int AS "count" FROM "sto_info_app"."site_admin_action"
      WHERE "action" IN ('SCAN_JOB_RETRIED', 'SCAN_JOB_DISCARDED') GROUP BY "action" ORDER BY 1`,
  );

  r.results.check(
    name,
    'Retry and discard in the site admin log',
    logged.some(row => row.action === 'SCAN_JOB_RETRIED') &&
      (unretryable.length === 0 ||
        logged.some(row => row.action === 'SCAN_JOB_DISCARDED')),
    null,
    logged.map(row => `${row.action} ${row.count}`).join(', '),
  );
  await r.checkNothingUnscanned(name);
}

/**
 * Scenario 7: the stale-upload sweep, which abandons uploads nothing came
 * back for after 24 hours — but not while the pipeline is stopped, nor for
 * 24 hours after it starts again.
 *
 * The upload is made stale by losing its scan request, which is what the
 * sweep exists for, and by ageing it in SQL. The sweep is run as the nightly
 * cron runs it, through `FileAssetUploadCleanupService`, in a process of its
 * own built from the backend's module without starting it (see
 * `sweep.js`, written beside the build).
 *
 * @param r - The rehearsal.
 */
async function staleUploadSweep(r: Rehearsal): Promise<void> {
  const name = 'S7 Stale-upload sweep';

  await r.containers.stop('clamd');

  try {
    await waitFor(
      'the worker heartbeat to say PAUSED',
      () =>
        r.db.value<boolean>(
          `SELECT true AS "value" FROM "sto_info_worker"."worker_heartbeat_status"
            WHERE "state" = 'PAUSED' AND "beatAt" > now() - interval '2 minutes' LIMIT 1`,
        ),
      180_000,
      1_000,
    );

    const upload = await r.uploadRoster();
    const removed = await removeScanRequest(r.config, upload.assetId);

    r.results.record(
      name,
      "An upload's scan request lost",
      removed ? 'INFO' : 'FAIL',
      null,
      removed ? 'removed from file-scan' : 'no scan request found to remove',
    );
    await r.db.query(
      `UPDATE "sto_info_app"."file_asset_placement"
          SET "createdAt" = "createdAt" - interval '25 hours'
        WHERE "assetId" = $1`,
      [upload.assetId],
    );

    let swept = await r.runSweep();

    r.results.check(
      name,
      'Upload over 24 hours old kept while the worker is paused',
      swept.log.includes('(WORKER_PAUSED)') &&
        (await r.placementState(upload.assetId)) === 'PENDING',
      swept.seconds,
      `${swept.summary}; placement ${await r.placementState(upload.assetId)}`,
    );

    await r.containers.start('clamd');
    await waitFor('clamd', () => pingClamd(r.config.ports.clamd), 300_000);
    await waitFor(
      'the heartbeat to say RUNNING',
      () =>
        r.db.value<boolean>(
          `SELECT true AS "value" FROM "sto_info_worker"."worker_heartbeat_status"
            WHERE "state" = 'RUNNING' AND "beatAt" > now() - interval '1 minute' LIMIT 1`,
        ),
      180_000,
      1_000,
    );

    swept = await r.runSweep();
    r.results.check(
      name,
      'Still kept within 24 hours of the pipeline starting again',
      swept.log.includes('(RECENTLY_RESUMED)') &&
        (await r.placementState(upload.assetId)) === 'PENDING',
      swept.seconds,
      swept.summary,
    );

    // Everything that stopped the pipeline, moved back 25 hours: the alerts
    // that opened and cleared during the rehearsal, and the last resume.
    const open = await r.db.value<number>(
      `SELECT count(*)::int AS "value" FROM "sto_info_app"."operations_alert"
        WHERE "kind" IN ('WORKER_SILENT', 'WORKER_PAUSED', 'QUEUES_UNREACHABLE') AND "clearedAt" IS NULL`,
    );

    if (open !== 0) {
      throw new Error(`${open} stopping alert(s) still open`);
    }

    await r.db.query(
      `UPDATE "sto_info_app"."operations_alert"
          SET "openedAt" = "openedAt" - interval '25 hours',
              "lastSeenAt" = "lastSeenAt" - interval '25 hours',
              "clearedAt" = "clearedAt" - interval '25 hours'
        WHERE "kind" IN ('WORKER_SILENT', 'WORKER_PAUSED', 'QUEUES_UNREACHABLE')`,
    );
    await r.db.query(
      `UPDATE "sto_info_app"."app_setting"
          SET "value" = jsonb_set("value"::jsonb, '{resumedAt}',
                to_jsonb(to_char((now() - interval '25 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))::text
        WHERE "key" = 'FILE_PUBLICATION_PAUSED' AND "value"::jsonb ? 'resumedAt'`,
    );

    swept = await r.runSweep();

    const assetAfter = await r.assetState(upload.assetId);
    const placementAfter = await r.placementState(upload.assetId);

    r.results.check(
      name,
      'Abandoned once every hold has aged out',
      placementAfter === 'ABANDONED' && assetAfter === 'DELETED',
      swept.seconds,
      `${swept.summary}; asset ${assetAfter}, placement ${placementAfter}`,
    );
  } finally {
    await r.containers.start('clamd').catch(() => undefined);
  }

  await r.checkNothingUnscanned(name);
}

/**
 * Scenario 8: a scan that fails part way is asked again, and its attempt
 * reopened rather than refused.
 *
 * clamd is frozen under a scan, so the scan runs out its 120-second timeout
 * and the attempt finishes `FAILED`. The worker answers `RETRY`, the backend
 * marks the upload `RETRY_PENDING`, and the re-queue sweep sends it again
 * once it has been still for two minutes; the worker reopens the attempt,
 * being under `SCAN_MAX_ATTEMPTS`, and scans it.
 *
 * @param r - The rehearsal.
 */
async function transientScanFailure(r: Rehearsal): Promise<void> {
  const name = 'S8 Transient scan failure';

  await r.containers.pause('clamd');

  let upload: Upload;
  let attemptId: string | null;

  try {
    upload = await r.uploadRoster();
    await waitFor(
      'the worker to claim the scan',
      async () =>
        ['CLAIMED', 'SCANNING'].includes(
          (await r.attemptState(upload.assetId)) ?? '',
        ),
      60_000,
    );
    attemptId = await r.db.value<string>(
      `SELECT "id"::text AS "value" FROM "sto_info_worker"."file_scan_attempt" WHERE "assetId" = $1`,
      [upload.assetId],
    );

    const failed = await waitFor(
      'the frozen scan to fail',
      async () => (await r.attemptState(upload.assetId)) === 'FAILED',
      240_000,
      1_000,
    ).catch(() => null);

    if (failed === null) {
      r.results.record(
        name,
        'Scan under a frozen clamd finished FAILED',
        'INFO',
        null,
        `it did not (attempt ${await r.attemptState(upload.assetId)}); the reopening was not exercised`,
      );

      return;
    }

    r.results.record(
      name,
      'Scan under a frozen clamd finished FAILED',
      'PASS',
      failed.seconds,
      'the scan timeout (SCAN_TIMEOUT_MS, 120 s)',
    );
  } finally {
    await r.containers.unpause('clamd');
  }

  const marked = await waitFor(
    'the upload to be marked RETRY_PENDING',
    async () => (await r.assetState(upload.assetId)) === 'RETRY_PENDING',
    60_000,
  ).catch(() => null);

  r.results.check(
    name,
    'Backend marks the upload RETRY_PENDING',
    marked !== null,
    marked?.seconds ?? null,
    `asset ${await r.assetState(upload.assetId)}`,
  );

  const since = Date.now();
  const done = await r.imported(upload, 420_000);
  const attempts = await r.db.query<{ id: string; state: string }>(
    `SELECT "id"::text AS "id", "state"::text AS "state" FROM "sto_info_worker"."file_scan_attempt" WHERE "assetId" = $1`,
    [upload.assetId],
  );

  r.results.record(
    name,
    'Asked again by the re-queue sweep, and in force',
    'PASS',
    secondsSince(since),
    `${done.toFixed(1)} s from RETRY_PENDING`,
  );
  r.results.check(
    name,
    'The failed attempt was reopened, not replaced',
    attempts.length === 1 &&
      attempts[0].id === attemptId &&
      attempts[0].state === 'CLEAN',
    null,
    attempts.map(attempt => attempt.state).join(', '),
  );
  await r.checkNothingUnscanned(name);
}

/**
 * Runs every scenario and writes the results.
 */
async function main(): Promise<void> {
  const r = new Rehearsal();
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

    await scenario(r, 'S2 Restart mid-work', () => restartMidWork(r));
    await outages(r);
    await scenario(r, 'S4 Restore', () => restore(r));
    await scenario(r, 'S5 Rollback', () => rollback(r));
    await scenario(r, 'S6 Failed-job recovery', () => failedJobs(r));
    await scenario(r, 'S7 Stale-upload sweep', () => staleUploadSweep(r));
    await scenario(r, 'S8 Transient scan failure', () =>
      transientScanFailure(r),
    );

    const attempts = r.egress.attemptsSince();
    const counted = new Map<string, number>();

    for (const target of attempts) {
      counted.set(target, (counted.get(target) ?? 0) + 1);
    }

    r.results.record(
      'All',
      'Outbound calls refused by the egress guard',
      'INFO',
      null,
      attempts.length === 0
        ? 'none'
        : [...counted]
            .map(([target, count]) => `${target} x${count}`)
            .join(', '),
    );

    const [from, to] = r.oldReleaseWindow;
    const current = r.egress
      .attemptsSince()
      .filter(target => target.includes('cloudflare'));
    const old = r.egress
      .attemptsBetween(from, to)
      .filter(target => target.includes('cloudflare'));

    r.results.check(
      'All',
      'The current release never tried to reach Cloudflare',
      current.length === old.length,
      null,
      `${current.length - old.length} attempt(s) outside the older release's run`,
    );
  } finally {
    await r.stopApps();
    await r.db.close();
    await r.egress.close();

    const images = await Promise.all(
      (['pg', 'redis', 'minio', 'clamd', 'aws'] as const).map(service =>
        r.containers.image(service).catch(() => '?'),
      ),
    );
    const logsCopy = `${r.config.results.replace(/\.md$/, '')}-logs`;

    mkdirSync(logsCopy, { recursive: true });

    for (const file of readdirSync(r.logs)) {
      copyFileSync(join(r.logs, file), join(logsCopy, file));
    }

    r.results.write(r.config.results, [
      `Run ${started.toISOString()} to ${new Date().toISOString()} on ${process.platform}, Node ${process.version}.`,
      '',
      `- Backend: ${r.config.repo}; worker: ${r.config.workerRepo} (working trees as built).`,
      `- Images: ${images.join(', ')} (clamd as the worker configures it).`,
      `- Older release: ${r.config.oldBackendMain === null ? `not built (${r.config.oldBackendSkipped})` : r.config.oldBackendRef}.`,
      '- Every stop of an application is a hard kill (the crash case); on Windows nothing else is possible.',
      '- Deployed defaults throughout (scan lease 5 min, heartbeat 30 s, health poll 30 s, alert thresholds as coded),',
      '  except CLAMAV_MAX_DEFINITION_AGE_HOURS=720 because the image carries its build-day signatures.',
      `- Application logs: ${logsCopy}`,
    ]);
    console.log(`\nResults written to ${r.config.results}`);
  }

  if (r.results.failures > 0) {
    throw new Error(`${r.results.failures} check(s) failed`);
  }
}

// Run when started as a script, and not when the adversarial rehearsal
// (FC-043) imports the stack's set-up from here.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
