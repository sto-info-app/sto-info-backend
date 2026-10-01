# Operations rehearsal

Rehearses what the runbooks in [`docs/operations/`](../../docs/operations/README.md) say to do when
the worker or the backend restarts, a dependency goes away, the database is restored from a
backup or a release is rolled back — against the real backend and the real worker, built from
these checkouts — and records how long each step took (FC-042).

```bash
npm run rehearse:operations
```

The same stack runs FC-043's [adversarial rehearsal](../adversarial-rehearsal/README.md) with
`npm run rehearse:adversarial` (`run-rehearsal.sh adversarial`), which never builds the older
release.

Its clamd also knows one signature of the rehearsal's own, `FC043.Rehearsal.Marker`, for a marker
made for the run: the adversarial rehearsal plants it where EICAR cannot reach (see its README).
Nothing here writes the marker, so the operations rehearsal is unaffected.

## What it needs

- Docker, and the images below (pulled once; the defaults are what the developer stack already
  uses where it can).
- Both repositories checked out side by side, each with `npm ci` done:
  `sto-info-backend` and `sto-info-file-scan-worker`. Point `REHEARSAL_WORKER_REPO` elsewhere if
  they are not siblings.
- About 30 minutes: four or five to build (the older release installs and builds alongside),
  twenty-five to rehearse. Most of that is waiting on purpose: a five-minute scan lease, a
  two-minute scan timeout, two to four minutes of Redis outage, a minute of bucket outage,
  one-minute alert ticks.

It builds both applications into its own temporary directory with `tsc`, so neither checkout's
`dist/` changes, and it runs them as processes on the host.

## What it touches

Nothing it did not create. Every container is named `ops-rehearsal-<pid>-*`, is on a network of
its own, publishes only on `127.0.0.1`, and uses ports from 55400 up (`REHEARSAL_PORT_BASE` moves
them) — never the developer stack's `postgres1`, `sto-redis`, `stoi-clamav` or `stoi-minio`, nor
their ports. Containers, their volumes, the network, the scanner image and the temporary directory
are removed on exit, including on failure or `Ctrl+C`.

| Stands in for       | Container | Image (override)                                                                                 |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| Render PostgreSQL   | `-pg`     | `postgres:18-alpine` (`REHEARSAL_PG_IMAGE`)                                                      |
| Render Key Value    | `-redis`  | `redis:7-alpine` (`REHEARSAL_REDIS_IMAGE`)                                                       |
| Cloudflare R2       | `-minio`  | `minio/minio:RELEASE.2025-04-22T22-12-26Z` (`REHEARSAL_MINIO_IMAGE`)                             |
| The worker's clamd  | `-clamd`  | built on `clamav/clamav:stable` with the worker's `docker/clamd.conf` (`REHEARSAL_CLAMAV_IMAGE`) |
| AWS Secrets Manager | `-aws`    | `localstack/localstack:3.8` (`REHEARSAL_AWS_IMAGE`)                                              |

**No real secret is read.** No `.env` file is loaded, and both applications are started with an
environment built from nothing. Every credential is generated for the run and never printed: the
database and MinIO passwords, the site admin's password (the admin is inserted in SQL with a
bcrypt hash), and a fake secret in LocalStack holding every key both applications read, under
FC-042's names only. The AWS SDK is pointed at LocalStack with its own `AWS_ENDPOINT_URL`
variable; no application code knows it is being rehearsed.

**Nothing leaves the machine.** Both applications are given an HTTP(S) proxy that refuses every
request and records it (`NODE_USE_ENV_PROXY=1` makes `fetch` honour it too), with only
`127.0.0.1` exempt. A call to Cloudflare Images, which has no configurable endpoint, cannot get
out; the results say whether any was attempted.

**Synthetic data only.** Every upload is a roster export derived from
`test/fixtures/fleet-community/Fixture Basic Fleet_20240101-120000.Csv` — a later filename stamp,
one figure changed, sometimes one invented member — imported into the local fixture Fleet. A roster
import is a restricted file: quarantine, scan, publish into rows, and no Cloudflare. The only
pictures are two generated 8-pixel PNGs in the restore scenario, which are never scanned before the
database is restored under them and so never reach publication.

## What it rehearses

Every stop of an application is a hard kill: on Windows nothing else is possible, and the crash is
the harder case. Everything runs on deployed defaults — a five-minute scan lease, 30-second
heartbeats and health polls, the alert thresholds as coded — except
`CLAMAV_MAX_DEFINITION_AGE_HOURS=720`, because the scanner image carries the signatures of the day
it was built. So `SIGNATURES_STALE` opens during a run, correctly.

| Scenario                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                      | What must hold                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 Cold start             | Starts every container; migrates the backend in two parts with the site admin made between them (`1790000600000-SeedStorytimeTags` refuses to run without one), then the worker; starts both applications; seeds the fixture Fleet once the backend has made the platforms; imports a roster; keeps a `pg_dump` of this state for S5.                                                                                                             | The restore check runs before the API listens; the worker beats `RUNNING`.                                                                                                                                                                                                                                                                                                                                                                                       |
| S2 Restart mid-work       | Kills the backend the moment it has accepted an upload; then freezes clamd, kills the worker while it holds a scan, and starts it again.                                                                                                                                                                                                                                                                                                          | Nothing is published while either is down; both uploads complete after the restart. The second waits out the dead worker's lease.                                                                                                                                                                                                                                                                                                                                |
| S3a Redis outage          | Stops Redis until `QUEUES_UNREACHABLE` opens (two minutes, judged each minute); reads Scan Diagnostics, the failed-jobs list and the publication switch; pauses publication; uploads; kills the backend and starts it again before Redis returns; starts Redis again.                                                                                                                                                                             | The three reads answer within 6 s; the pause is accepted, and the queue is paused once Redis returns; the upload answers within about 6 s as `RETRY_PENDING` and is in force after Redis returns, queued again by the re-queue sweep (`[requeue] Scan requests queued again`) despite the restart; the backend logs its rate limits counted in memory during the outage and in Redis again after it; the alert opens and clears; nothing is published unscanned. |
| S3b clamd outage          | Stops clamd, uploads, ages the heartbeat's pause past ten minutes in SQL, starts clamd.                                                                                                                                                                                                                                                                                                                                                           | The heartbeat says `PAUSED` with a reason; the upload waits and nothing fails; `WORKER_PAUSED` opens, notifies, and clears after clamd returns.                                                                                                                                                                                                                                                                                                                  |
| S3c Bucket outage at boot | Stops MinIO and starts the backend.                                                                                                                                                                                                                                                                                                                                                                                                               | `/health/ready` never answers while the ledgers cannot be read; it does once MinIO is back.                                                                                                                                                                                                                                                                                                                                                                      |
| S4 Restore                | Takes a `pg_dump`; then denies an upload (a superseded picture), erases a member, places a moderation hold and has a member close their own account (`DELETE /user/close-account`); restores the dump into a fresh database and boots on it.                                                                                                                                                                                                      | All four are brought back before the API listens — the account closed again with its original `deletedAt` — and `LEDGERS_RECONCILED` is logged.                                                                                                                                                                                                                                                                                                                  |
| S5 Rollback               | Steps `migration:revert` back on two copies: today's database, and the backup taken at the end of S1; calls `1797200000000`'s `down` directly on today's copy, in a rolled-back transaction; writes an unpublished picture reference in SQL; checks the secret's key names; pauses publication, starts the older release (`REHEARSAL_OLD_REF`, default `origin/production`) against today's database and secret, comes forward again and resumes. | On today's copy the revert is refused while publication is paused and, once the Security Log holds FC-042's actions, at `1797500000000`; `1797200000000` refuses once `LEDGERS_RECONCILED` is logged. On the S1 copy the revert reaches the picture guard, which refuses. The write is refused with `IRG01`; the older release cannot start without its retired secret names; the held upload publishes on resume.                                               |
| S6 Failed-job recovery    | Stops MinIO as a held upload is released for publication, so the publication runs out of attempts; starts it again; retries that job with a reason; refuses a retry of the scan job the restore left behind (its asset is gone) and discards it.                                                                                                                                                                                                  | The publication is listed as failed and retryable and completes on retry; the settled job is refused and discarded; `FAILED_JOBS` opens and clears; both actions are in the site admin log.                                                                                                                                                                                                                                                                      |
| S7 Stale-upload sweep     | Stops clamd, uploads, removes the upload's scan request from Redis (a lost request, which is what the sweep is for) and ages it 25 hours in SQL; runs the sweep as the nightly cron does, in a process of its own; starts clamd and runs it again; ages every alert that stopped the pipeline, and the last resume, 25 hours in SQL and runs it once more.                                                                                        | Kept while the worker is paused; kept within 24 hours of the pipeline starting again; abandoned once every hold has aged out.                                                                                                                                                                                                                                                                                                                                    |
| S8 Transient scan failure | Freezes clamd under a scan until the scan times out (120 s), then thaws it.                                                                                                                                                                                                                                                                                                                                                                       | The attempt finishes `FAILED`; the backend marks the upload `RETRY_PENDING`; the re-queue sweep asks again and the worker reopens the same attempt, which ends `CLEAN`, and the upload is in force.                                                                                                                                                                                                                                                              |

The older release is exported with `git archive` (no worktree is added), installed with `npm ci`
and built, in the background while the current code builds. `REHEARSAL_SKIP_OLD_BUILD=1` skips it.

## Results

Each check prints as `PASS`, `FAIL` or `INFO` with its time in seconds. The whole table is written
as Markdown to `REHEARSAL_RESULTS` (by default a file in the system temporary directory, named in
the last line of output), with the applications' logs beside it. The exit status is non-zero if any
check failed. The results are not committed; [the rehearsal page](../../docs/operations/rehearsal.md)
records the timings from a run.
