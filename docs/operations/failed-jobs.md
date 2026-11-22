# Failed jobs: retry and dead-letter response

What to do when a queue gives up on a job. The rules each queue follows are in
[File assets](../file-assets.md#failed-jobs); this page is the procedure.

## Where failures go

**BullMQ's failed set is the dead-letter store.** A job that has used all its attempts stays in its
queue's failed set, with its data and its error, until somebody retries or discards it. Nothing
else holds it, and nothing expires it.

| Queue                    | Kept on failure               | Produced by                                                                               |
| ------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `file-scan`              | Yes                           | The backend: one per upload (`<assetId>_<policyVersion>`) or rescan (`rescan_<rescanId>`) |
| `file-scan-verdict`      | Yes                           | The worker: one per answer, keyed by the attempt's ID and the time of its answer          |
| `file-asset-publication` | Yes                           | The backend: one per asset, keyed by the asset's ID                                       |
| `chat-transcript`        | Yes                           | The backend: a new job per request                                                        |
| `fleet-roster-replay`    | Yes                           | The backend: a new job per request                                                        |
| `image-estate`           | **No** (`removeOnFail: true`) | Each run records its own failures and is resumed from its page, on the Image estate panel |
| `file-rescan`            | **No** (`removeOnFail: true`) | A campaign's failed batch is resumed with the campaign, on the Rescan campaigns panel     |

Any job in the failed set of the first five opens `FAILED_JOBS`, which stays open until every one
has been retried or discarded.

## What comes back by itself

- **Scan requests that never reached the queue, or were lost from it.** Every minute, once Redis
  answers, the backend's re-queue sweep sends again the request of any stored upload that has
  waited more than two minutes for a scan (`QUARANTINED`, `SCANNING` or `RETRY_PENDING`) with no
  job on `file-scan` under its ID `<assetId>_<policyVersion>`, 50 a run, and logs
  `[requeue] Scan requests queued again - Count: n`. A job still on the queue in any state — failed
  included — is left alone, and so is an upload whose verdict is in `file-scan-verdict`'s failed
  set: both are this page's to retry or discard.
- **Stranded verdicts.** A scan that finished while Redis was away has its verdict in the worker's
  database but not on the queue. The worker resends every such verdict once as it starts and then
  every ten minutes (`STRANDED_VERDICT_RESEND_INTERVAL_MS`), up to 100 a pass and ten passes a
  sweep, and logs `Resent N stranded verdicts`. A duplicate is harmless: the backend refuses a
  verdict for an upload that is no longer `SCANNING`. See the worker's
  [queues documentation](../../../sto-info-file-scan-worker/docs/queues.md#recovering-from-a-redis-loss).
- **A failed publication or verdict asked for again.** BullMQ ignores an `add` whose job ID is
  already in the queue in any state, so a kept failed job used to swallow every later request for
  the same work. Now `AssetPublicationQueueService.enqueue`, and the worker's verdict publisher,
  send the failed job round again with its attempts back instead. The backend logs
  `[enqueue] Failed publication sent round again - AssetId: …`; the worker logs
  `Failed verdict sent round again`. A verdict job is keyed by its attempt and the time of the
  answer, so only the same answer is revived: a reopened attempt's new answer goes out as a new
  job.
- **A scan that failed on a transient fault.** The worker reopens a `FAILED` attempt when the
  re-queue sweep asks again, up to its attempt budget (`SCAN_MAX_ATTEMPTS`, three claims); after
  that it answers the final refusal `RETRY_BUDGET_EXHAUSTED`, the upload is refused, and nothing
  asks again.
- **Roster replays.** The ten-minute sweep queues a fresh replay for any Fleet whose projection is
  behind, whether or not an earlier one failed.

## Reading the list

Scan Diagnostics › Failed jobs, or `GET /admin/file-scanning/failed-jobs?queue=&page=`. The first
page of every queue is read with the rest of Scan Diagnostics and logged with it; a later page, or
one queue chosen, logs its own `SCAN_DIAGNOSTICS_VIEWED` entry in the Security Log. Queue by queue, newest
failure first, 25 to a page, each job shows:

- the queue, job ID, name, attempts made and when it failed;
- the asset, transcript or Fleet it is about;
- **the failure reduced to a code**: a network error's code (`ECONNREFUSED`, `ETIMEDOUT` and so
  on), `HTTP_<status>`, `TIMEOUT`, `STALLED`, or the thrown error's class name. Never the job's
  data or the error's text, which can quote a statement's values or a host. The full error is in
  the service's log on Render;
- **whether a retry could help** (`retryable`), and if not, why (`notRetryableBecause`: `SETTLED`,
  the record has moved on; `NO_SUBJECT`, the job names nothing to act on).

A retry is only allowed while it can change something, because every job is read against its
record when it runs. The per-queue rule is in
[File assets](../file-assets.md#failed-jobs); in short, the upload, rescan, publication, transcript
or replay the job is about must still be waiting for it.

## The response

Every action takes a reason (up to 500 characters) and is written to the Security Log.

1. **Fix the cause first.** Group the failures by code. `ECONNREFUSED`, `ETIMEDOUT` or `HTTP_5xx`
   against Cloudflare: check Cloudflare's status and wait for it. On `file-asset-publication`, an
   S3 error's name (`TimeoutError`, `InternalError`, `AccessDenied` and so on) means the quarantine
   bucket could not be read: check R2's status and the quarantine keys. Only a missing object is
   final; any other bucket error fails the job so that it is retried, and is retryable here. `HTTP_401` or `HTTP_403`: a
   credential has been revoked or is wrong; check the keys in [Render services](render-services.md#secrets).
   `STALLED`: an instance died mid-job; check the service's restarts. Retrying before the cause is
   gone only fails the jobs again.
2. **Retry one** that matters now (**Retry**, `POST /admin/file-scanning/failed-jobs/:queue/:jobId/retry`).
   It goes round again with its attempts back. A 409 says why it cannot: it has not failed, a
   retry would change nothing, or somebody got there first.
3. **Retry the rest** (**Retry all**, `POST /admin/file-scanning/failed-jobs/retry-all`, optionally
   for one queue). It looks at up to 500 failed jobs a press, retries those a retry can help, skips
   the rest, and logs one `SCAN_JOB_RETRIED` entry with the counts. Press again while `remaining`
   is above nought.
4. **Watch them.** A retried scan job always ends in a verdict: the worker repeats a finished
   attempt's answer, and a spent retry budget answers `RETRY_BUDGET_EXHAUSTED`. A retried
   publication job waits with the rest while publication is paused.
5. **Discard what cannot be helped** (**Discard unretryable**,
   `POST /admin/file-scanning/failed-jobs/discard-unretryable`, optionally for one queue). It
   removes only the jobs a retry cannot help, up to 500 a press, and logs one `SCAN_JOB_DISCARDED`
   entry with the counts. Their records have moved on, so nothing is lost.
6. **Discard one by hand** (**Discard**, `POST /admin/file-scanning/failed-jobs/:queue/:jobId/discard`)
   only when you are sure: it removes any failed job, retryable or not, and the work it held is not
   done. Say why in the reason.
7. **Check the alert clears.** `FAILED_JOBS` clears at the next minute's run once the failed sets
   are empty, and every site admin is told.

Discarding is not deleting evidence: the Security Log keeps who discarded what and why, and the
record the job was about is unchanged.
