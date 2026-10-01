# Rehearsal

FC-042 asked for these runbooks to be rehearsed, not only written. They are rehearsed twice: on
throwaway containers on a developer's machine, here, and on Render in FC-052
([#1287](https://app.shortcut.com/startrekonlineinfo/story/1287)).

## Locally

Steve's decision of 30 September 2026: a script that builds its own throwaway stack, as the
[migration rehearsal](../../scripts/migration-rehearsal/README.md) does, and leaves the developer's
own containers alone — `postgres1`, `sto-redis` and the `stoi-` containers are never touched.

```bash
npm run rehearse:operations
```

The script lives in `scripts/operations-rehearsal/`; its
[README](../../scripts/operations-rehearsal/README.md) has the detail.

- **What it needs.** Docker, and both repositories checked out side by side with `npm ci` done in
  each (`REHEARSAL_WORKER_REPO` points it at a worker elsewhere). It builds both applications
  itself, with `tsc`, into a temporary directory — neither checkout's `dist/` changes — and runs
  them as processes on the host. It also exports the release a rollback would go back to
  (`REHEARSAL_OLD_REF`, default `origin/production`) with `git archive`, installs and builds it;
  `REHEARSAL_SKIP_OLD_BUILD=1` skips that.
- **What it runs against.** Its own PostgreSQL 18, Redis, MinIO (for R2), clamd (the worker's
  `docker/clamd.conf`) and LocalStack (for Secrets Manager), named `ops-rehearsal-<pid>-*`, on a
  network of their own, on `127.0.0.1` ports from 55400 up. All of them are removed on exit,
  including on failure or `Ctrl+C`.
- **No real secret, no real data, nothing outside.** No `.env` is read; every credential is
  generated for the run and never printed, and the secret in LocalStack holds FC-042's key names
  only. Every upload is a roster export derived from the synthetic test fixtures. Both
  applications are given a proxy that refuses every outside call and records it, so nothing can
  reach Cloudflare.
- **How long.** About 30 minutes: four or five to build, twenty-five to rehearse. Most of it is
  waiting on purpose: a crashed scan's five-minute lease, a frozen scan's two-minute timeout, Redis
  away until `QUEUES_UNREACHABLE` opens, a minute of bucket outage, one-minute alert ticks.
- **Where the results go.** Each check prints `PASS`, `FAIL` or `INFO` with its time in seconds.
  The whole table is written as Markdown to `REHEARSAL_RESULTS` (by default a file in the system
  temporary directory, named in the last line of output), with the applications' logs beside it.
  The exit status is non-zero if any check failed. Results are not committed; the timings below
  are copied from a run.

Every stop of an application is a hard kill: on Windows nothing else is possible, and a crash is
the harder case. So the worker's `STOPPING` state is not rehearsed. Everything runs on the
deployed defaults — the five-minute scan lease, 30-second heartbeats and health polls, the alert
thresholds as coded — except `CLAMAV_MAX_DEFINITION_AGE_HOURS=720`, because the scanner image
carries the signatures of the day it was built (so `SIGNATURES_STALE` opens during a run, as it
should).

What it rehearses, runbook by runbook:

| Runbook                                                 | Scenarios                                                   | What the run shows                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Readiness and heartbeats](readiness-and-heartbeats.md) | S1 cold start, S2 restarts, S3b clamd away, S3c bucket away | The backend does not listen until the restore check has finished, and serves nothing while the bucket is unreachable; the worker's heartbeat shows `RUNNING`, and `PAUSED` with its reason (`SCANNER_UNREACHABLE`)                                                                                                                                                                                                                                                      |
| [Scanner signatures](scanner-signatures.md)             | S1, S3b                                                     | The image's old signatures open `SIGNATURES_STALE`; clamd away pauses the worker, and it resumes on its own when clamd returns                                                                                                                                                                                                                                                                                                                                          |
| [Alerts](alerts.md)                                     | S3a Redis away, S3b, S6                                     | `QUEUES_UNREACHABLE`, `WORKER_PAUSED` (its pause aged in SQL) and `FAILED_JOBS` each open past their threshold and clear; `WORKER_PAUSED` is checked to notify the site admin                                                                                                                                                                                                                                                                                           |
| [Failed jobs](failed-jobs.md)                           | S6 failed jobs, S8 transient scan failure                   | A scan that failed part way is asked again by the re-queue sweep and its attempt reopened, not refused; A publication that ran out of attempts while the bucket was away is listed as retryable and publishes on retry; the scan job the restore left behind is refused a retry and discarded; both are in the Security Log                                                                                                                                             |
| [Restore](restore.md)                                   | S4 restore                                                  | After restoring a backup taken before them, the boot brings back an erasure, a moderation hold, an asset deny and an account closure (with its date) before anything is served, and logs `LEDGERS_RECONCILED`                                                                                                                                                                                                                                                           |
| [Rollback](rollback.md)                                 | S5 rollback                                                 | `migration:revert` refuses while publication is paused, at `1797500000000` once the Security Log holds its actions, at `1797200000000` once `LEDGERS_RECONCILED` is logged, and at the picture guard; a direct write of an unpublished picture reference is refused with `IRG01`; the production release cannot start without its retired secret names                                                                                                                  |
| [Incidents](incidents.md)                               | S2, S3a, S5, S7 stale-upload sweep                          | Nothing is published unscanned through any outage; while Redis is away Scan Diagnostics still answers, publication can still be paused, and an upload is accepted and queued once Redis returns, across a backend restart; pausing publication holds a cleared upload across a rollback and roll-forward, and resuming publishes it; the stale-upload sweep keeps an old upload while the pipeline is stopped and for a day after, and abandons it once that has passed |

Stranded verdicts (a scan finished while the verdict queue was unreachable) are not rehearsed:
nothing on the local stack could time a Redis outage into the moment between a scan's end and
its verdict's send.

## Timings

From a run on 1 October 2026 (00:20 to 00:44 UTC), on Steve's Windows 11 machine with Docker
Desktop, Node 24.21: 103 checks passed, none failed. The machine was busier than in earlier runs
(the cold start took 59 s against 42–46 s before), so most steps here are a second or two slower
than they need be.

| Step                                                                                    | Time                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every container ready from `docker start` (clamd, signatures loaded, slowest)           | 20.2 s                                                                                                                                                                           |
| Backend migrations on an empty database / worker migrations                             | 20.0 s / 2.4 s                                                                                                                                                                   |
| Backend start to listening, nothing to bring back                                       | 15.4 s (restore check 60 ms list, 47 ms compare)                                                                                                                                 |
| Backend restart to listening, after a kill                                              | 12.7 s                                                                                                                                                                           |
| Backend restart to listening while Redis is away                                        | 18.5 s                                                                                                                                                                           |
| Restore check with markers to replay (and how many)                                     | 12.4 s to listening; 4 replayed (1 erasure, 1 hold, 1 deny, 1 closure) in 346 ms                                                                                                 |
| Restore check's backfill of markers the ledgers lacked (and how many)                   | 33 ms for 6 asset-deny markers                                                                                                                                                   |
| Backend start to listening with the bucket away for 60 s                                | 76.7 s (15.9 s after the bucket returned; 6 failed checks)                                                                                                                       |
| `pg_dump` / restore into a fresh database (0.9 MB)                                      | 1.1 s / 7.2 s                                                                                                                                                                    |
| Worker start to `RUNNING`                                                               | 3.0–3.6 s                                                                                                                                                                        |
| Worker `PAUSED` after clamd stops / `RUNNING` after it returns                          | 18 s / 22 s (clamd itself takes about 20 s to load)                                                                                                                              |
| A scan the worker was killed during, completed after its restart                        | 305 s (the five-minute lease)                                                                                                                                                    |
| A scan that failed (clamd frozen past the 120 s scan timeout), asked again and in force | 167.5 s from the failure (the re-queue sweep waits for two minutes of stillness)                                                                                                 |
| Stranded verdicts resent after a worker start                                           | Not rehearsed (see above)                                                                                                                                                        |
| Scan Diagnostics, the failed-jobs list and the publication switch, Redis away           | 6.1 s, 5.0 s (503), 6.0 s                                                                                                                                                        |
| Pausing publication, Redis away / the queue paused once Redis returns                   | 6.1 s / 25 s after Redis started (the next minute's run)                                                                                                                         |
| An upload, Redis away                                                                   | 5.3 s to its 202 (`RETRY_PENDING`)                                                                                                                                               |
| That upload in force once Redis returns, the backend restarted in between               | 31 s after Redis started (the next minute's re-queue run)                                                                                                                        |
| An alert opening after its threshold is passed                                          | `WORKER_PAUSED` within a minute of the pause passing ten minutes; `FAILED_JOBS` within 2 s of the job failing; `QUEUES_UNREACHABLE` 2–4 min after Redis goes (130 s in this run) |
| An alert clearing after the problem goes                                                | 7–60 s (the next one-minute tick)                                                                                                                                                |
| A publication running out of attempts (bucket away)                                     | 76.6 s (5 attempts, backoff from 5 s)                                                                                                                                            |
| A retried publication completing                                                        | 0.6 s                                                                                                                                                                            |
| Publication resuming after the pause is lifted                                          | 0.6 s to the held upload in force                                                                                                                                                |
| The production release refusing to start without its secret names                       | 12.9 s                                                                                                                                                                           |
| The stale-upload sweep, in a process of its own                                         | 12 s                                                                                                                                                                             |

`QUEUES_UNREACHABLE` opens on the first one-minute tick after Redis has failed to answer for two
minutes, and the first failure is only seen at the next tick after Redis goes: so between two and
four minutes, not two.

**While Redis is away the API serves, a little slower.** Each read above is about five seconds of
the page giving up on Redis's figures, plus about a second the first time the rate limiter finds
Redis gone: it then counts in the instance's own memory, and asks Redis again only every ten
seconds (see [Backend](../backend.md#when-redis-cannot-answer-fc-042)). The backend logs `Rate
limits counted in memory while Redis cannot answer` as it goes and `Rate limits counted in Redis
again` when Redis answers; the rehearsal checks both. An upload is answered within the five
seconds its scan request is given, as `RETRY_PENDING`, and `ScanRequeueService` queues it at the
first minute's run after Redis answers (`[requeue] Scan requests queued again`), which the
rehearsal also checks — with the backend that accepted it killed and restarted in between, so
nothing but the database could have remembered it (see
[File assets](../file-assets.md#uploads-made-while-redis-is-down)).

### Worth knowing from the last run

- A replayed account closure's `deletedAt` is the ledger's, written a few milliseconds before the
  closure itself (22 ms in the run) and to the millisecond. The rehearsal accepts anything within
  a second.
- A backend started while Redis is away takes about six seconds longer to listen: its rate
  limiters each wait their second on Redis as they start (`[init] Rate limits counted in memory`).

## On Render (FC-052)

Creating the Render services, and rehearsing these runbooks on them, is FC-052, done last. The
local stack stands in for R2 (MinIO) and the scanner; nothing stands in for Render itself, so
FC-052 also confirms what these pages mark "to confirm on Render": the PostgreSQL plan, its
connection limit and backup retention, the dashboard's restore and suspend steps, the regions and
the secret names. See [Render services](render-services.md#to-confirm-on-render-fc-052).
