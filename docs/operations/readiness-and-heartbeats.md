# Readiness and heartbeats

How to tell whether the API is serving, and whether the file scan worker is scanning, paused, idle
or gone.

- [The backend](#the-backend)
- [The worker](#the-worker)
- [Reading the heartbeat](#reading-the-heartbeat)
- [Pause reasons](#pause-reasons)

## The backend

| Route               | Answers                                                        | Used by                  |
| ------------------- | -------------------------------------------------------------- | ------------------------ |
| `GET /health/live`  | Always up, once the server listens                             | People; a liveness check |
| `GET /health/ready` | A database ping: 200, or 503 when the database does not answer | Render's health check    |

Both are excluded from rate limiting and need no sign-in. Neither asks Redis: a Redis outage
leaves the API serving, and is reported by the `QUEUES_UNREACHABLE` alert instead
([Alerts](alerts.md#queues_unreachable)). The rest of the API serves through it too: its rate
limits, normally counted in Redis, are counted in each instance's own memory until Redis answers
again, so a client can make that many more requests per instance, and the first request after
Redis goes takes about a second longer (see
[Backend](../backend.md#when-redis-cannot-answer-fc-042)).

**Neither answers until the restore check has finished.** `main.ts` runs the check before
`app.init()` and `app.listen()`, so an instance that cannot read the ledgers — the quarantine
bucket or the database is unreachable — retries with backoff and never listens. On Render that
looks like a deploy that never goes healthy while the previous instance carries on serving. Its
log says why, once per attempt:

```text
[run] Restore check failed; the API waits for it - Attempt: n, RetryInMs: t, Reason: …
```

and, when it gets through:

```text
[reconcile] Restore check finished - Erasures: m/r/b, Holds: m/r/b, Assets: m/r/b, ListMs: …, CompareMs: …, ReplayMs: …, BackfillMs: …
```

`m/r/b` is markers, replayed and backfilled. See [Restore](restore.md#what-the-boot-does-by-itself).

**What to do when a deploy never goes healthy:**

1. Read the backend's log for `Restore check failed`. The `Reason` names what failed.
2. If it is the bucket: check the quarantine keys in the secret
   (`cloudflareR2QuarantineAccessKey`, `cloudflareR2QuarantineSecret`),
   `CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME`, `CLOUDFLARE_R2_ENDPOINT`, and Cloudflare's status.
3. If it is the database: check `DB_*`, `dbPassword` and the database's own status on Render.
4. If the log shows neither line, the instance did not reach the check: look for a missing secret
   key (`Missing Cloudflare secret keys: …`) or a failed `migration:run` above it.
5. Do not work around the check. It is what stops a restored database serving something erased,
   held or denied.

## The worker

The worker listens on port 3000 (`APP_PORT`):

| Route               | Answers                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`       | Liveness: answers without asking the scanner, so a worker whose `clamd` is still loading is not restarted for it                                    |
| `GET /health/ready` | 503 while `clamd` cannot be reached, will not say how old its signatures are, or holds signatures older than `CLAMAV_MAX_DEFINITION_AGE_HOURS` (48) |

**Render never asks either.** The worker is a background worker, and background workers are not
probed. What enforces readiness is the worker itself: `EngineHealthService` asks `clamd` every
`CLAMAV_HEALTH_POLL_MS` (30 seconds), and the processor pauses its BullMQ worker while the scanner
is unfit and resumes it when it is fit again. Jobs wait in the queue instead of failing. The
endpoints report the same answer, for a person with a shell on the container or running it
locally.

So from Render a paused worker and an idle one look the same: both are running and quiet. The
heartbeat is how anybody outside the process tells them apart.

## Reading the heartbeat

Each worker process upserts one row in `sto_info_worker.worker_heartbeat` when it starts, every
`WORKER_HEARTBEAT_INTERVAL_MS` (30 seconds), as soon as the scanner's health changes, and once more
as `STOPPING` on the way out. It records its state, why it is paused, the signatures `clamd` last
reported, and how many jobs it has in hand. Rows a day stale are deleted by the workers. The worker's
[database documentation](../../../sto-info-file-scan-worker/docs/database.md#worker_heartbeat-and-worker_heartbeat_status)
has every column.

The backend reads it through the `worker_heartbeat_status` view, which its role may `SELECT`, and
counts a worker **live** when its last beat is at most 120 seconds old by the database's clock.

**On Scan Diagnostics**, the Worker panel shows each live process, latest beat first: its state,
its signatures and their age, its jobs in hand and when it last beat. It says so when the heartbeat
cannot be read. The route behind it, `GET /admin/file-scanning/diagnostics`, returns every process
in `workers`, live or not.

**In SQL**, as the backend's role or any role that can read the worker's schema:

```sql
SELECT "workerId", "state", "pauseReason", "jobsInHand",
       now() - "beatAt" AS "sinceBeat",
       now() - "pausedSince" AS "pausedFor",
       "definitionsVersion", "definitionsBuiltAt"
FROM "sto_info_worker"."worker_heartbeat_status"
ORDER BY "beatAt" DESC;
```

| What it shows                           | What it means                                                                                        | What to do                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `RUNNING`, beat within a minute         | Consuming. An empty queue is genuinely idle.                                                         | Nothing.                                              |
| `PAUSED`, beat within a minute          | Alive, and refusing work because its scanner is unfit. Jobs wait; none fail.                         | Read `pauseReason`, below.                            |
| `STOPPING`                              | Shutting down, finishing any job in hand: a deploy or a restart.                                     | A new row should appear from the replacement process. |
| No row beat in the last two minutes     | The process has gone, or cannot reach the database. `WORKER_SILENT` opens.                           | Check the worker service and its log on Render.       |
| `PAUSED` with no reason, and staying so | The scanner is fit again but the resume did not take. It will not retry while the scanner stays fit. | Restart the worker.                                   |

## Pause reasons

| Code                  | Meaning                                                                              | What to do                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `SCANNER_NOT_ASKED`   | The worker has only just started and has not asked `clamd` yet.                      | Wait a poll (30 seconds).                                                                               |
| `SCANNER_UNREACHABLE` | `clamd` is not answering: loading its database after a start or reload, or down.     | Wait a few minutes after a start or a signature reload; if it lasts, read the worker's log for `clamd`. |
| `SIGNATURES_UNDATED`  | `clamd` answered but did not say how old its signatures are. That counts as too old. | Read the worker's log; restart the worker.                                                              |
| `SIGNATURES_TOO_OLD`  | The signatures are older than 48 hours: `freshclam` has been failing.                | [Scanner signatures](scanner-signatures.md#when-freshclam-is-failing).                                  |
| `UNKNOWN`             | A reason this build has no code for.                                                 | Read the worker's log.                                                                                  |

`WORKER_PAUSED` opens when every live worker has been paused for 10 minutes or more; see
[Alerts](alerts.md).
