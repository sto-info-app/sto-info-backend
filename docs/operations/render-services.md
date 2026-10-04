# Render services, secrets and connection budgets

What runs on Render, what each part reads from AWS Secrets Manager, and how many connections each
holds. The general hosting notes are in [Infrastructure](../infrastructure.md); the worker's are in
its [infrastructure documentation](../../../sto-info-file-scan-worker/docs/infrastructure.md).

- [The services](#the-services)
- [Deploy order](#deploy-order)
- [Secrets](#secrets)
- [Connection budgets](#connection-budgets)
- [To confirm on Render (FC-052)](#to-confirm-on-render-fc-052)

## The services

| Service                                        | Type                              | How it starts                                                                     | Health                                                       |
| ---------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Backend (`sto-info-backend`)                   | Web service, Node runtime         | Build `npm install && npm run build`; start `npm run start:render`                | Render probes `/health/ready`                                |
| File scan worker (`sto-info-file-scan-worker`) | Background worker, Docker runtime | The image's entrypoint (s6): migrations, then `clamd`, `freshclam` and the worker | Not probed; the worker pauses itself, and writes a heartbeat |
| PostgreSQL                                     | Managed, PostgreSQL 18            | —                                                                                 | —                                                            |
| Redis                                          | Managed, Starter                  | —                                                                                 | —                                                            |

### The backend

- **Start.** `start:render` is `npm run migration:run && npm run start:prod`: every deploy, and
  every rollback, runs the build's pending migrations before the API starts.
- **Then the restore check.** `main.ts` runs `RestoreCheckService.run()` after the application is
  built and before `app.init()`, so nothing listens — no route, socket, queue worker or scheduled
  job — until the four ledgers have been compared with the database. While the quarantine bucket
  or the database cannot be reached it retries, doubling from 1 second to 60, for as long as it
  takes. See [Restore](restore.md#what-the-boot-does-by-itself).
- **Health check `/health/ready`.** A database ping. Because the server does not listen until the
  restore check has finished, a deploy whose check cannot finish never goes healthy, and the
  previous instance keeps serving. See [Readiness and heartbeats](readiness-and-heartbeats.md).
- **Instances.** One, with auto-scaling off ([Infrastructure](../infrastructure.md#scaling-configuration)).
  More are safe: the restore check and the alert cron each hold a PostgreSQL advisory lock, and
  chat's socket.io traffic goes through the Redis adapter.
- **Deploys.** From the `production` branch, per [Infrastructure](../infrastructure.md#backend-web-service-configuration),
  whose own TODO to confirm the service name and branch still stands.

### The file scan worker

Declared in the worker's `render.yaml`; the reasons are in ADR-0020 and the worker's
[infrastructure documentation](../../../sto-info-file-scan-worker/docs/infrastructure.md).

- **Docker**, because `clamd` lives in the image. The signature database is baked in at build time,
  so `clamd` answers about seven seconds after the container starts.
- **Region Frankfurt**, to keep uploaded roster material in the EU.
- **Plan: the smallest with 2 GB of memory.** `render.yaml` deliberately does not name it. Measured
  peaks are about 1,068 MiB through a signature reload, with `ConcurrentDatabaseReload no`; see
  [Scanner signatures](scanner-signatures.md#reloads-and-memory).
- **One instance.** `render.yaml` sets no count. Several can run at once safely — an attempt is
  claimed by one statement against a unique constraint — but each holds its own copy of the
  signature database.
- **No disk.** Bytes are streamed from the quarantine bucket to `clamd` and never written down.
- **`branch: production`, `autoDeploy: false`.** The worker is deployed by hand, after the backend.
- **Environment.** `render.yaml` fixes `FILE_SCAN_SCHEMA_VERSION` 2, `DB_SCHEMA` `sto_info_worker`,
  `TYPEORM_SYNCHRONIZE` false, `SCAN_CONCURRENCY` 1, `CLAMAV_HOST` 127.0.0.1, `CLAMAV_PORT` 3310,
  `CLAMAV_MAX_DEFINITION_AGE_HOURS` 48, `CLAMAV_HEALTH_POLL_MS` 30000, `SCAN_UNHEALTHY_RETRY_MS`
  60000, `WORKER_HEARTBEAT_INTERVAL_MS` 30000 and `STRANDED_VERDICT_RESEND_INTERVAL_MS` 600000. The
  rest (`AWS_*`, `CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME`, `REDIS_URL`,
  `DB_*` and `BACKEND_DB_ROLE`) are set in the dashboard.

### PostgreSQL and Redis

One PostgreSQL instance serves both applications: the backend owns `sto_info_app`, the worker owns
`sto_info_worker`, and each has its own role. The worker's role has no rights in the backend's
schema beyond the foreign key into `file_asset`; the backend's role reads only the worker's
`scan_usage`, `scan_engine_status` and `worker_heartbeat_status` views. See
[Database](../database.md#a-second-schema-owned-by-the-file-scan-worker).

Redis holds rate limiting, the BullMQ queues and chat's socket.io adapter. It is load-bearing for
file safety: while it is down no upload can be scanned, so none is published.
[Infrastructure](../infrastructure.md#redis-service-configuration) has the plan.

## Deploy order

1. **The backend first.** Its migrations must run before the worker's, because the worker's
   `file_scan_attempt` has a foreign key into `sto_info_app.file_asset`. The failure the other way
   round is loud: the worker's migration does not apply and its container stops.
2. **Wait for the backend to go live.** Its log shows `[reconcile] Restore check finished - …`
   before it listens.
3. **Then the worker**, by hand (`autoDeploy: false`). Its `migrate` oneshot runs its migrations;
   if they fail, the container stops rather than running a worker that cannot work.
4. **Check the heartbeat.** Scan Diagnostics shows the new worker process, `PAUSED` with
   `SCANNER_NOT_ASKED` or `SCANNER_UNREACHABLE` while `clamd` loads its database, then `RUNNING`.
   The old process's last row says `STOPPING`. See
   [Readiness and heartbeats](readiness-and-heartbeats.md).

## Secrets

Each service names its secret in `AWS_SECRET_NAME` and reads it with the two AWS keys Render
holds, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. Those two, per service, are the only
credentials in Render's environment: there is no `DB_PASSWORD` anywhere. Locally both applications
share `sto_info_app_local_dev`. The production secret's name, and whether the worker has one of its
own, are to confirm on Render (FC-052); the worker's documentation says its AWS key reaches one
secret and nothing else.

Never paste a value into a ticket, a log, a chat or this repository. The shapes below are key names
only. How keys are rotated and revoked is in
[Security](../security.md#secrets-management-policy-silvergold).

### What the backend reads

From the code (`SecretsService.getSecret` callers), as of FC-042:

| Key                                                               | Read by                                                             | Without it                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `jwtSecret`                                                       | Authentication                                                      | Nobody can sign in                                                                 |
| `dbPassword`                                                      | `config/typeorm.config.ts`                                          | No database                                                                        |
| `sendGridApiKey`                                                  | Mail, as the fallback when SES fails                                | No fallback                                                                        |
| `sesEmailHmacSecret`                                              | The SES webhook, to hash recipient addresses                        | Addresses are hashed with an empty key, with a warning                             |
| `cloudflareImagesAccountId`                                       | `ImageUploadsService`                                               | No picture publishing                                                              |
| `cloudflareImagesGatedApiKey`                                     | `ImageUploadsService`: publishes, signs, lists and deletes pictures | **Refuses to start**                                                               |
| `cloudflareR2GatedAccessKey`, `cloudflareR2GatedSecret`           | The public R2 bucket's client (legacy Character portraits)          | **Refuses to start**                                                               |
| `cloudflareR2QuarantineAccessKey`, `cloudflareR2QuarantineSecret` | The quarantine bucket: uploads and the four ledgers                 | Uploads fail; the restore check retries for ever                                   |
| `cloudflareR2ExportsAccessKey`, `cloudflareR2ExportsSecret`       | The exports bucket: chat transcripts (FC-035)                       | Transcripts fail                                                                   |
| `rosterErasureKey`                                                | Roster erasure's HMAC (FC-038)                                      | Erasure and preview answer 503; once anybody is erased, roster uploads are refused |
| `cloudflareImagesSigningKey`                                      | Signed picture addresses (FC-040)                                   | Nothing is signed; new pictures go up public                                       |

The three `Gated` keys are required at boot: `ImageUploadsService` names every missing one and the
API does not start. They replaced `cloudflareImagesApiKey`, `cloudflareR2AccessKey` and
`cloudflareR2Secret`, which are **no longer read** — they are what a build from before FC-012
reads, and retiring them is half of what stops such a build publishing unscanned uploads. See
[Rollback](rollback.md#retiring-the-old-credentials-at-release). `cloudmersiveApiKey` is no longer
read either.

**Still to add to production before the Fleet Community v1 release** (Steve):

- `cloudflareR2ExportsAccessKey` and `cloudflareR2ExportsSecret`;
- `rosterErasureKey` — a long random string, kept for good: without it the suppression list
  cannot be matched;
- `cloudflareImagesSigningKey`, from Cloudflare's R2 and Images › Images › Keys;
- the three renamed keys, `cloudflareImagesGatedApiKey`, `cloudflareR2GatedAccessKey` and
  `cloudflareR2GatedSecret`, holding **new** tokens.

[Environment variables](../environment-variables.md#aws-secrets-manager-secret-shape) has the full
shape.

### What the worker reads

Exactly three keys: `dbPassword` (its own role's), `cloudflareR2QuarantineReadKey` and
`cloudflareR2QuarantineReadSecret` — a token that may only read the quarantine bucket. One bucket
serves every environment, so **every quarantine credential is a production credential**, whichever
environment issued it. See the worker's
[environment variables](../../../sto-info-file-scan-worker/docs/environment-variables.md#aws-secrets-manager).

## Connection budgets

The backend's deploy starts the new instance before the old one stops, and the old one keeps
serving until the new one is healthy; assume the worker's overlaps the same way. For the length of
a deploy, then, a service holds its connections twice. Plan for that peak, not the steady state.

### Redis

Measured locally on 28 September 2026 ([Infrastructure](../infrastructure.md#redis-service-configuration)):

| Holder                                      | Connections                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Each backend instance                       | About 14: one for rate limiting, about ten for BullMQ's queues and workers, two for the chat adapter, one for chat presence |
| Each worker instance                        | About 4                                                                                                                     |
| One backend and one worker, both mid-deploy | About 36                                                                                                                    |

The Starter plan allows 250. The failed-jobs list and the operations alerts use the queues the
application already holds and open no connections of their own.

### PostgreSQL

Neither application sets a pool size: `config/typeorm.config.ts` passes no `poolSize` or `extra`,
and nor does the worker's. So node-postgres's default applies, **at most 10 connections per
DataSource**, opened as needed.

| Holder                                          | DataSources                                                                                                                                       | Connections at most                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Each backend instance                           | One (`TypeOrmModule.forRootAsync` in `app.module.ts`)                                                                                             | 10. The restore check and the alert run each hold one of them for their advisory lock while they work |
| Each worker instance                            | One (`app.module.ts`)                                                                                                                             | 10                                                                                                    |
| The backend's `migration:run` in `start:render` | Two in turn, in a separate process that exits before the API starts: a bootstrap one that creates the schema if absent, then the migration runner | A couple, briefly, while the old instance is still serving                                            |
| The worker's `migrate` oneshot                  | The same pattern                                                                                                                                  | A couple, briefly                                                                                     |
| One backend and one worker, both mid-deploy     |                                                                                                                                                   | About 44                                                                                              |

Add one for each person connected with `psql`, and 10 for any script that starts its own
application context against the database (`scripts/replay-fleet-rosters.ts` does). Each further
backend instance adds 10, and 10 more while it deploys.

The production plan's connection limit is not known yet. Check the figure above against it in
FC-052; if it is too tight, the fix is a `poolSize` in both applications' TypeORM options, not a
larger plan by default.

## To confirm on Render (FC-052)

Steve's decision of 30 September 2026: these are not known, and are checked on the live account in
FC-052 rather than guessed here.

- **The production PostgreSQL plan.** [Infrastructure](../infrastructure.md#database-service-configuration)
  records Basic-256mb, but under a TODO nobody has closed.
- **Its connection limit**, against the budget above.
- **Its backup retention**, and whether point-in-time recovery is available on it. The same page
  records "7-day logical backup retention", equally unchecked. [Restore](restore.md) depends on it.
- **The backend's region.** The worker is in Frankfurt; it reaches PostgreSQL and Redis on
  Render's private network only if they share its region.
- **The production secret's name**, and whether the worker has its own.
- **The worker's plan name** for 2 GB.
- **Only what comes through Cloudflare is served** (FC-044). Before the release: put a long random
  `cloudflareOriginVerifySecret` in the production secret (and a different one in the dev
  secret); add a Cloudflare Transform Rule on `api.startrekonline.info` (and `dev-api.`) that sets
  `X-Origin-Verify` to it; check that the site, sign-in and chat's socket work through Cloudflare,
  and that a request straight to the origin is refused `403` while `/health/ready` still answers;
  then switch off the service's `onrender.com` subdomain. The backend refuses to start without the
  secret. See [Infrastructure: origin proxy trust](../infrastructure.md#origin-proxy-trust).
