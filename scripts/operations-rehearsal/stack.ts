/**
 * The throwaway stack the operations rehearsal runs against (FC-042).
 *
 * Everything here talks only to what `run-rehearsal.sh` created for this run:
 * containers named with the run's prefix, on ports it chose, holding
 * credentials it generated. Nothing reads a `.env` file, and the two
 * applications are started with an environment built from nothing rather
 * than inherited, so a developer's configuration — a real secret name, a real
 * bucket, AWS credentials — cannot leak into a rehearsal.
 *
 * It is not a Jest spec, for the same reason the migration rehearsal is not:
 * it needs containers, it is slow, and it must not be part of a suite that
 * enforces one hundred per cent coverage on code it does not exercise.
 */
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, createWriteStream, readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { connect as connectSocket } from 'node:net';
import { delimiter, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { DataSource, QueryRunner } from 'typeorm';

const run = promisify(execFile);

/** Where every piece of the stack is, as `run-rehearsal.sh` set it up. */
export interface StackConfig {
  /** The run's scratch directory, removed on exit. */
  readonly work: string;
  /** The backend checkout being rehearsed. */
  readonly repo: string;
  /** The worker checkout being rehearsed. */
  readonly workerRepo: string;
  /** Every container's name starts with this. */
  readonly prefix: string;
  /** Host ports, all bound to 127.0.0.1. */
  readonly ports: {
    readonly postgres: number;
    readonly redis: number;
    readonly minio: number;
    readonly clamd: number;
    readonly aws: number;
    readonly backend: number;
    readonly worker: number;
    readonly egress: number;
  };
  /** Generated for this run; never printed. */
  readonly postgresPassword: string;
  /** Generated for this run; never printed. */
  readonly minioPassword: string;
  /** The built backend's entry point. */
  readonly backendMain: string;
  /** The built worker's entry point. */
  readonly workerMain: string;
  /** The older release's entry point, or null when it was not built. */
  readonly oldBackendMain: string | null;
  /** What the older release was built from, for the results. */
  readonly oldBackendRef: string;
  /** Why the older release was not built, when it was not. */
  readonly oldBackendSkipped: string | null;
  /** Where the results are written. */
  readonly results: string;
}

/** The MinIO user every bucket credential in the fake secret names. */
export const MINIO_USER = 'ops-rehearsal';

/** The fake secret both applications read. */
export const SECRET_NAME = 'ops-rehearsal/app';

/** The buckets the backend expects, all in MinIO. */
export const BUCKETS = {
  delivery: 'rehearsal-delivery',
  quarantine: 'rehearsal-quarantine',
  exports: 'rehearsal-exports',
} as const;

/** The BullMQ prefix both applications share, apart from any real one. */
export const QUEUE_PREFIX = 'bull:ops-rehearsal:';

/** The main database, and the one a restore goes into. */
export const DATABASES = {
  main: 'rehearsal',
  restored: 'rehearsal_restored',
  probe: 'rehearsal_rollback_probe',
} as const;

/**
 * Reads a variable `run-rehearsal.sh` must have set.
 *
 * @param name - The variable.
 * @returns Its value.
 * @throws Error when it is missing.
 */
function required(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set; run this through npm run rehearse:operations`,
    );
  }

  return value;
}

/**
 * Reads the stack's configuration from the environment the shell script set.
 *
 * @returns The configuration.
 */
export function readConfig(): StackConfig {
  const work = required('REHEARSAL_WORK');
  const oldMain = process.env.REHEARSAL_OLD_BACKEND_MAIN ?? '';

  return {
    work,
    repo: required('REHEARSAL_REPO'),
    workerRepo: required('REHEARSAL_WORKER_REPO'),
    prefix: required('REHEARSAL_PREFIX'),
    ports: {
      postgres: Number(required('REHEARSAL_PG_PORT')),
      redis: Number(required('REHEARSAL_REDIS_PORT')),
      minio: Number(required('REHEARSAL_MINIO_PORT')),
      clamd: Number(required('REHEARSAL_CLAMD_PORT')),
      aws: Number(required('REHEARSAL_AWS_PORT')),
      backend: Number(required('REHEARSAL_BACKEND_PORT')),
      worker: Number(required('REHEARSAL_WORKER_PORT')),
      egress: Number(required('REHEARSAL_EGRESS_PORT')),
    },
    postgresPassword: required('REHEARSAL_PG_PASSWORD'),
    minioPassword: required('REHEARSAL_MINIO_PASSWORD'),
    backendMain: join(work, 'backend', 'src', 'main.js'),
    workerMain: join(work, 'worker', 'src', 'main.js'),
    oldBackendMain: oldMain === '' ? null : oldMain,
    oldBackendRef: process.env.REHEARSAL_OLD_REF ?? 'origin/production',
    oldBackendSkipped: process.env.REHEARSAL_OLD_SKIPPED ?? null,
    results: required('REHEARSAL_RESULTS'),
  };
}

/**
 * Makes a random value for a credential nobody will ever type.
 *
 * @param bytes - How much randomness.
 * @returns It, as hex.
 */
export function generated(bytes = 24): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Seconds since a moment, to one decimal place.
 *
 * @param since - The moment, from `Date.now()`.
 * @returns The seconds.
 */
export function secondsSince(since: number): number {
  return Math.round((Date.now() - since) / 100) / 10;
}

/**
 * Thrown by a probe when waiting longer cannot help, such as a process that
 * has exited: {@link waitFor} gives up at once rather than at its timeout.
 */
export class StopWaiting extends Error {}

/** What waiting for something came to. */
export interface Waited<T> {
  readonly value: T;
  /** Seconds it took. */
  readonly seconds: number;
}

/**
 * Asks until the answer is something, or gives up.
 *
 * @param what - What is being waited for, for the error.
 * @param probe - Answers null, undefined or false until it is ready.
 * @param timeoutMs - How long to wait.
 * @param intervalMs - How long between asking.
 * @returns The answer and how long it took.
 * @throws Error when it never came.
 */
export async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<Waited<T>> {
  const started = Date.now();
  let lastError = '';

  while (Date.now() - started < timeoutMs) {
    try {
      const value = await probe();

      if (value !== null && value !== undefined && value !== false) {
        return { value, seconds: secondsSince(started) };
      }
    } catch (error: unknown) {
      if (error instanceof StopWaiting) {
        throw error;
      }

      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out after ${timeoutMs / 1000}s waiting for ${what}` +
      (lastError === '' ? '' : ` (last error: ${lastError})`),
  );
}

/**
 * Runs a Docker command against this run's containers.
 *
 * Called directly rather than through a shell, so no container-side path is
 * ever rewritten by Git Bash on Windows.
 *
 * @param args - The arguments.
 * @returns What it printed.
 */
export async function docker(...args: string[]): Promise<string> {
  const { stdout } = await run('docker', args, {
    maxBuffer: 16 * 1024 * 1024,
  });

  return stdout.trim();
}

/** The containers of this run. */
export class Containers {
  /**
   * Creates an instance of Containers.
   *
   * @param _prefix - The run's container prefix.
   */
  constructor(private readonly _prefix: string) {}

  /**
   * Names one of the run's containers.
   *
   * @param service - Which.
   * @returns Its name.
   */
  name(service: Service): string {
    return `${this._prefix}-${service}`;
  }

  /**
   * Starts containers.
   *
   * @param services - Which.
   */
  async start(...services: Service[]): Promise<void> {
    await docker('start', ...services.map(service => this.name(service)));
  }

  /**
   * Stops containers, as an outage would.
   *
   * @param services - Which.
   */
  async stop(...services: Service[]): Promise<void> {
    await docker(
      'stop',
      '--time',
      '10',
      ...services.map(service => this.name(service)),
    );
  }

  /**
   * Freezes a container: it keeps its connections and answers nothing.
   *
   * @param service - Which.
   */
  async pause(service: Service): Promise<void> {
    await docker('pause', this.name(service));
  }

  /**
   * Thaws a frozen container.
   *
   * @param service - Which.
   */
  async unpause(service: Service): Promise<void> {
    await docker('unpause', this.name(service));
  }

  /**
   * Runs a shell command inside a container.
   *
   * @param service - Which.
   * @param command - The command, quoted for `sh -c`.
   * @param env - Variables to set inside.
   * @returns What it printed.
   */
  async exec(
    service: Service,
    command: string,
    env: Record<string, string> = {},
  ): Promise<string> {
    const flags = Object.entries(env).flatMap(([key, value]) => [
      '-e',
      `${key}=${value}`,
    ]);

    return docker('exec', ...flags, this.name(service), 'sh', '-c', command);
  }

  /**
   * Reads an image's identity, for the results.
   *
   * @param service - Which container's image.
   * @returns The image name.
   */
  async image(service: Service): Promise<string> {
    return docker(
      'inspect',
      '--format',
      '{{.Config.Image}}',
      this.name(service),
    );
  }
}

/** The run's containers. */
export type Service = 'pg' | 'redis' | 'minio' | 'clamd' | 'aws';

/**
 * Asks clamd for PONG over its published port.
 *
 * @param port - The host port.
 * @returns Whether it answered.
 */
export function pingClamd(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connectSocket(port, '127.0.0.1');
    let reply = '';
    const giveUp = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2_000);

    socket.on('connect', () =>
      socket.write(
        Buffer.concat([Buffer.from('zPING', 'ascii'), Buffer.alloc(1)]),
      ),
    );
    socket.on('data', chunk => {
      reply += chunk.toString('utf8');

      if (reply.includes('PONG')) {
        clearTimeout(giveUp);
        socket.destroy();
        resolve(true);
      }
    });
    socket.on('error', () => {
      clearTimeout(giveUp);
      resolve(false);
    });
  });
}

/**
 * Asks Redis for PONG.
 *
 * @param port - The host port.
 * @returns Whether it answered.
 */
export function pingRedis(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connectSocket(port, '127.0.0.1');
    const giveUp = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2_000);

    socket.on('connect', () => socket.write('PING\r\n'));
    socket.on('data', chunk => {
      clearTimeout(giveUp);
      socket.destroy();
      resolve(chunk.toString('utf8').startsWith('+PONG'));
    });
    socket.on('error', () => {
      clearTimeout(giveUp);
      resolve(false);
    });
  });
}

/** One SQL connection to one of the rehearsal's databases. */
export class Database {
  private _source: DataSource | null = null;

  /**
   * Creates an instance of Database.
   *
   * @param _config - The stack.
   * @param name - Which database.
   */
  constructor(
    private readonly _config: StackConfig,
    public readonly name: string,
  ) {}

  /**
   * Runs a statement, reconnecting first if the last connection died.
   *
   * @param sql - The statement.
   * @param params - Its parameters.
   * @returns Its rows.
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const source = await this.source();

    try {
      return (await source.query(sql, params)) as T[];
    } catch (error: unknown) {
      // A connection a container restart broke is dropped, so the next
      // statement gets a new one. A statement PostgreSQL refused is not.
      if (sqlState(error) === null) {
        await this.close();
      }

      throw error;
    }
  }

  /**
   * Reads one value.
   *
   * @param sql - A statement returning one row with a column `value`.
   * @param params - Its parameters.
   * @returns The value, or null when there is no row.
   */
  async value<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<{ value: T }>(sql, params);

    return rows.length === 0 ? null : rows[0].value;
  }

  /**
   * Runs something on one connection inside a transaction that is always
   * rolled back, so a statement that should have refused changes nothing
   * even if it does not.
   *
   * @param body - What to run.
   */
  async inRolledBackTransaction(
    body: (runner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const runner = (await this.source()).createQueryRunner();

    try {
      await runner.connect();
      await runner.startTransaction();
      await body(runner);
    } finally {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction().catch(() => undefined);
      }

      await runner.release();
    }
  }

  /** Closes the connection, if there is one. */
  async close(): Promise<void> {
    const source = this._source;

    this._source = null;

    if (source !== null) {
      await source.destroy().catch(() => undefined);
    }
  }

  /**
   * Connects, once.
   *
   * @returns The connection.
   */
  private async source(): Promise<DataSource> {
    if (this._source !== null) {
      return this._source;
    }

    const source = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: this._config.ports.postgres,
      username: 'postgres',
      password: this._config.postgresPassword,
      database: this.name,
      poolSize: 2,
      connectTimeoutMS: 3_000,
    });

    await source.initialize();
    this._source = source;

    return source;
  }
}

/**
 * The SQLSTATE PostgreSQL refused a statement with.
 *
 * @param error - What was thrown.
 * @returns The code, or null when PostgreSQL did not refuse it.
 */
export function sqlState(error: unknown): string | null {
  const driverError = (error as { driverError?: { code?: unknown } })
    ?.driverError;
  const code = driverError?.code ?? (error as { code?: unknown })?.code;

  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/**
 * Builds a child's environment from nothing, plus what Windows and Node need
 * to run at all.
 *
 * @param variables - The application's own variables.
 * @returns The environment.
 */
export function cleanEnvironment(
  variables: Record<string, string>,
): NodeJS.ProcessEnv {
  const kept = [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'windir',
    'ComSpec',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'NODE_EXTRA_CA_CERTS',
  ];
  const base: NodeJS.ProcessEnv = {};

  for (const name of kept) {
    if (process.env[name] !== undefined) {
      base[name] = process.env[name];
    }
  }

  return { ...base, ...variables };
}

/** A backend or worker process the rehearsal started. */
export class AppProcess {
  private readonly _child: ChildProcess;
  private _exitCode: number | null | undefined = undefined;

  /**
   * Starts a process, logging to a file of its own.
   *
   * @param label - What it is, for the log's name.
   * @param main - The script to run.
   * @param cwd - Where to run it.
   * @param env - Its whole environment.
   * @param logPath - Where its output goes.
   * @param pidFile - Where every process the rehearsal starts is listed, so
   *   the shell script can stop them if this one dies first.
   */
  constructor(
    public readonly label: string,
    main: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    public readonly logPath: string,
    pidFile: string,
  ) {
    const log = createWriteStream(logPath, { flags: 'a' });

    this._child = spawn(process.execPath, [main], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this._child.stdout?.pipe(log);
    this._child.stderr?.pipe(log);
    this._child.on('exit', code => {
      this._exitCode = code;
    });

    if (this._child.pid !== undefined) {
      appendFileSync(pidFile, `${this._child.pid}\n`);
    }
  }

  /** Whether it is still running. */
  get running(): boolean {
    return this._exitCode === undefined;
  }

  /** How it ended, if it has. */
  get exitCode(): number | null | undefined {
    return this._exitCode;
  }

  /**
   * Everything it has logged so far.
   *
   * @returns The log.
   */
  log(): string {
    try {
      return readFileSync(this.logPath, 'utf8');
    } catch {
      return '';
    }
  }

  /**
   * Kills it outright and waits for it to go.
   *
   * On Windows a process cannot be sent SIGTERM, so every stop there is the
   * crash case. It is used everywhere, for the same result on every
   * platform: the harder case is the one worth rehearsing.
   */
  async kill(): Promise<void> {
    if (!this.running) {
      return;
    }

    const exited = new Promise<void>(resolve =>
      this._child.once('exit', () => resolve()),
    );

    this._child.kill('SIGKILL');
    await Promise.race([exited, sleep(15_000)]);
  }
}

/** Answers from the backend's API. */
export interface ApiAnswer<T = unknown> {
  readonly status: number;
  readonly body: T;
}

/** The backend's HTTP API, as a signed-in site admin. */
export class Api {
  private _token: string | null = null;

  /** The last answer's Cache-Control header, or null when it sent none. */
  lastCacheControl: string | null = null;

  /**
   * Creates an instance of Api.
   *
   * @param _port - The backend's port.
   */
  constructor(private readonly _port: number) {}

  /**
   * Signs in and keeps the access token.
   *
   * @param email - The account.
   * @param password - Its password, generated for this run.
   */
  async signIn(email: string, password: string): Promise<void> {
    const answer = await this.call<{ access_token?: string }>(
      'POST',
      '/auth/login',
      { email, password },
    );

    if (answer.status !== 200 || !answer.body.access_token) {
      throw new Error(`Sign-in failed with ${answer.status}`);
    }

    this._token = answer.body.access_token;
  }

  /**
   * Whether `/health/ready` answers 200.
   *
   * @returns True when it does; false when it answers anything else or
   *   nothing at all.
   */
  async ready(): Promise<boolean> {
    try {
      const response = await fetch(
        `http://127.0.0.1:${this._port}/health/ready`,
        { signal: AbortSignal.timeout(2_000) },
      );

      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Calls the API with a JSON body.
   *
   * @param method - The method.
   * @param path - The path.
   * @param body - The body, if any.
   * @param timeoutMs - How long to wait for an answer.
   * @returns The answer.
   */
  async call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<ApiAnswer<T>> {
    const response = await fetch(`http://127.0.0.1:${this._port}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this._token === null
          ? {}
          : { Authorization: `Bearer ${this._token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    this.lastCacheControl = response.headers.get('cache-control');

    return { status: response.status, body: await readBody<T>(response) };
  }

  /**
   * Uploads a file as multipart form data.
   *
   * @param path - The path.
   * @param field - The file's form field.
   * @param filename - Its name.
   * @param bytes - Its bytes.
   * @param contentType - Its declared type.
   * @param fields - Other form fields.
   * @param timeoutMs - How long to wait for an answer.
   * @returns The answer.
   */
  async upload<T = unknown>(
    path: string,
    field: string,
    filename: string,
    bytes: Buffer,
    contentType: string,
    fields: Record<string, string> = {},
    timeoutMs = 30_000,
  ): Promise<ApiAnswer<T>> {
    const form = new FormData();

    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }

    form.append(
      field,
      new Blob([new Uint8Array(bytes)], { type: contentType }),
      filename,
    );

    const response = await fetch(`http://127.0.0.1:${this._port}${path}`, {
      method: 'POST',
      headers:
        this._token === null ? {} : { Authorization: `Bearer ${this._token}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });

    return { status: response.status, body: await readBody<T>(response) };
  }
}

/**
 * Reads a response body as JSON when it is JSON.
 *
 * @param response - The response.
 * @returns The body.
 */
async function readBody<T>(response: Response): Promise<T> {
  const text = await response.text();

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/**
 * A forward proxy that refuses everything and remembers who asked.
 *
 * Both applications are started with it as their HTTPS and HTTP proxy, and
 * every address the rehearsal runs locally is exempt. So a call to Cloudflare,
 * to Cloudmersive or anywhere else on the internet cannot leave the machine,
 * and the rehearsal can say whether any was attempted.
 */
export class EgressGuard {
  private readonly _server: Server;
  private readonly _attempts: Array<{ at: number; target: string }> = [];

  /** Creates an instance of EgressGuard. */
  constructor() {
    this._server = createServer((request, response) => {
      this._attempts.push({ at: Date.now(), target: hostOf(request.url) });
      response.writeHead(403).end('Refused by the operations rehearsal');
    });
    this._server.on('connect', (request, socket) => {
      this._attempts.push({ at: Date.now(), target: request.url ?? '' });
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
  }

  /**
   * Starts listening.
   *
   * @param port - The port.
   */
  async listen(port: number): Promise<void> {
    await new Promise<void>(resolve =>
      this._server.listen(port, '127.0.0.1', () => resolve()),
    );
  }

  /**
   * The hosts anything tried to reach since a moment.
   *
   * @param since - The moment.
   * @returns Each attempt's target.
   */
  attemptsSince(since = 0): string[] {
    return this.attemptsBetween(since, Number.MAX_SAFE_INTEGER);
  }

  /**
   * The hosts anything tried to reach between two moments.
   *
   * @param from - The first moment.
   * @param to - The last moment.
   * @returns Each attempt's target.
   */
  attemptsBetween(from: number, to: number): string[] {
    return this._attempts
      .filter(attempt => attempt.at >= from && attempt.at <= to)
      .map(attempt => attempt.target);
  }

  /** Stops listening. */
  async close(): Promise<void> {
    await new Promise<void>(resolve => this._server.close(() => resolve()));
  }
}

/**
 * The host an absolute-form request named.
 *
 * @param url - The request target.
 * @returns Its host, or the target when it is not a URL.
 */
function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').host;
  } catch {
    return url ?? '';
  }
}

/**
 * Runs something against the rehearsal's Redis on a connection of its own,
 * which gives up at once rather than waiting for a Redis that is away.
 *
 * Read straight from Redis rather than through the admin API, because every
 * read of the failed-jobs list is written to the site admin log, and a
 * rehearsal polling it would fill the log with its own reads.
 *
 * @param config - The stack.
 * @param body - What to run.
 * @returns What it returned.
 */
async function withRedis<T>(
  config: StackConfig,
  body: (redis: Redis) => Promise<T>,
): Promise<T> {
  const redis = new Redis({
    host: '127.0.0.1',
    port: config.ports.redis,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();

    return await body(redis);
  } finally {
    redis.disconnect();
  }
}

/**
 * Counts failed jobs, queue by queue, as BullMQ keeps them.
 *
 * @param config - The stack.
 * @returns Each queue with any failed job, and how many.
 */
export function failedJobCounts(
  config: StackConfig,
): Promise<Record<string, number>> {
  return withRedis(config, async redis => {
    const counts: Record<string, number> = {};

    for (const key of await redis.keys(`${QUEUE_PREFIX}*:failed`)) {
      const count = await redis.zcard(key);

      if (count > 0) {
        const queue = key
          .slice(QUEUE_PREFIX.length, -':failed'.length)
          .replace(/^:/, '');

        counts[queue] = count;
      }
    }

    return counts;
  });
}

/**
 * Whether BullMQ still holds a job, in any state.
 *
 * @param config - The stack.
 * @param queue - The queue.
 * @param jobId - The job.
 * @returns True while its record exists.
 */
export function jobExists(
  config: StackConfig,
  queue: string,
  jobId: string,
): Promise<boolean> {
  return withRedis(
    config,
    async redis =>
      (await redis.keys(`${QUEUE_PREFIX}*${queue}:${jobId}`)).length > 0,
  );
}

/**
 * Opens one of the applications' queues, as BullMQ names it, for as long as
 * something needs it.
 *
 * @param config - The stack.
 * @param name - The queue.
 * @param body - What to do with it.
 * @returns What that returned.
 */
async function withQueue<T>(
  config: StackConfig,
  name: string,
  body: (queue: Queue) => Promise<T>,
): Promise<T> {
  const queue = new Queue(name, {
    connection: {
      host: '127.0.0.1',
      port: config.ports.redis,
      maxRetriesPerRequest: 1,
    },
    prefix: QUEUE_PREFIX,
  });

  try {
    return await body(queue);
  } finally {
    await queue.close();
  }
}

/**
 * Whether a queue is paused in Redis.
 *
 * @param config - The stack.
 * @param name - The queue.
 * @returns True when it is.
 */
export function queueIsPaused(
  config: StackConfig,
  name: string,
): Promise<boolean> {
  return withQueue(config, name, queue => queue.isPaused());
}

/**
 * Removes an upload's waiting scan request, as if it had been lost.
 *
 * @param config - The stack.
 * @param assetId - The upload's asset.
 * @returns Whether one was found and removed.
 */
export function removeScanRequest(
  config: StackConfig,
  assetId: string,
): Promise<boolean> {
  return withQueue(config, 'file-scan', async queue => {
    const jobs = await queue.getJobs(['wait', 'prioritized', 'delayed']);
    const job = jobs.find(
      candidate =>
        (candidate.data as { assetId?: unknown } | undefined)?.assetId ===
        assetId,
    );

    if (job === undefined) {
      return false;
    }

    await job.remove();

    return true;
  });
}

/**
 * Stores the fake secret in the local Secrets Manager.
 *
 * @param config - The stack.
 * @param secret - Every key either application reads.
 */
export async function seedSecret(
  config: StackConfig,
  secret: Record<string, string>,
): Promise<void> {
  await secretsClient(config).send(
    new CreateSecretCommand({
      Name: SECRET_NAME,
      SecretString: JSON.stringify(secret),
    }),
  );
}

/**
 * Reads back which keys the fake secret holds, and no value.
 *
 * @param config - The stack.
 * @returns Its key names.
 */
export async function secretKeys(config: StackConfig): Promise<string[]> {
  const answer = await secretsClient(config).send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME }),
  );

  return Object.keys(JSON.parse(answer.SecretString ?? '{}'));
}

/**
 * A Secrets Manager client for the local stand-in.
 *
 * @param config - The stack.
 * @returns The client.
 */
function secretsClient(config: StackConfig): SecretsManagerClient {
  return new SecretsManagerClient({
    region: 'eu-west-2',
    endpoint: `http://127.0.0.1:${config.ports.aws}`,
    credentials: { accessKeyId: 'rehearsal', secretAccessKey: 'rehearsal' },
  });
}

/**
 * An S3 client for the rehearsal's MinIO.
 *
 * @param config - The stack.
 * @returns The client.
 */
export function bucketClient(config: StackConfig): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `http://127.0.0.1:${config.ports.minio}`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: MINIO_USER,
      secretAccessKey: config.minioPassword,
    },
  });
}

/**
 * Creates the three buckets the backend expects.
 *
 * @param config - The stack.
 */
export async function createBuckets(config: StackConfig): Promise<void> {
  const client = bucketClient(config);

  for (const bucket of Object.values(BUCKETS)) {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

/**
 * The search path that lets a build outside its checkout find its modules:
 * its own output first, for the `src/...` imports `nest build` would have
 * rewritten, then the checkout's `node_modules`.
 *
 * @param build - The build's output directory.
 * @param checkout - The checkout it was built from.
 * @returns The value for `NODE_PATH`.
 */
export function nodePath(build: string, checkout: string): string {
  return [build, join(checkout, 'node_modules')].join(delimiter);
}

/**
 * Runs a Node script to completion, capturing what it printed.
 *
 * @param script - The script.
 * @param args - Its arguments.
 * @param cwd - Where to run it.
 * @param env - Its whole environment.
 * @returns Its exit code and output.
 */
export async function runNode(
  script: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; output: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';

    child.stdout?.on('data', chunk => (output += chunk.toString('utf8')));
    child.stderr?.on('data', chunk => (output += chunk.toString('utf8')));
    child.on('exit', code => resolve({ code: code ?? 1, output }));
  });
}
