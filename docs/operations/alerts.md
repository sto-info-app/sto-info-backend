# Alerts

Every operations alert, what it means and what to do. How the alerts work — the cron, the table,
the thresholds and why they are fixed in code — is in
[File assets](../file-assets.md#alerts); this page is what to do when one arrives.

## How you are told

- **Once when it opens, once when it clears.** `OperationsAlertService` runs every minute. When a
  problem opens, every site admin (role `ADMIN`, not disabled) gets one `WARNING` notification
  linking to Scan Diagnostics. While it stays open nothing more is sent. When it clears, each gets
  one `INFO` notification. A problem that comes back is a new alert and a new notification.
- **Scan Diagnostics** lists the alerts open now, oldest first, with when each opened and was last
  seen, and its counts.
- **Counts only.** An alert's detail is minutes, hours and counts: never a file name, a user or an
  error's text.
- **Local development too.** A backend running without a worker opens `WORKER_SILENT`.

The thresholds are constants in `src/operations/alerts/operations-alert.constants.ts`. Changing one
is a code change, reviewed like any other.

## The alerts

| Alert                     | Opens when                                                                                                                             | What it means                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `SCAN_QUEUE_LAG`          | The oldest waiting job on `file-scan` was queued more than **15 minutes** ago                                                          | Uploads are not being scanned                               |
| `PUBLICATION_QUEUE_LAG`   | The same on `file-asset-publication`, more than **15 minutes**; never while publication is paused                                      | Scanned uploads are not being published                     |
| `WORKER_SILENT`           | No worker has beaten in the last **2 minutes**, or the heartbeat view cannot be read                                                   | The worker has gone, or cannot reach the database           |
| `WORKER_PAUSED`           | Every live worker is `PAUSED`, and the latest pause began **10 minutes** ago or more                                                   | The worker is alive and refusing work: its scanner is unfit |
| `SIGNATURES_STALE`        | The newest signatures any live worker holds were built more than **36 hours** ago                                                      | `freshclam` has been failing; the worker stops at 48        |
| `FAILED_JOBS`             | Any job is in the failed set of `file-scan`, `file-scan-verdict`, `file-asset-publication`, `chat-transcript` or `fleet-roster-replay` | A queue gave up on something and it waits for a site admin  |
| `PUBLICATION_PAUSED_LONG` | Publication has been paused for more than **an hour**                                                                                  | Somebody paused it and it is still paused                   |
| `QUEUES_UNREACHABLE`      | Redis has not answered the alert run for **2 minutes** running                                                                         | Nothing is being queued, scanned or published               |
| `PURGE_OWED`              | A withdrawn picture's public copy has waited more than **24 hours** to be deleted from Cloudflare (FC-043)                             | A withdrawn picture can still be reached at its old address |

### `SCAN_QUEUE_LAG`

1. Open Scan Diagnostics. Is `WORKER_SILENT` or `WORKER_PAUSED` open too? Then that is the cause:
   follow it below.
2. If the worker is `RUNNING`, look at the queue and the awaiting counts. A large backlog after an
   outage clears by itself at `SCAN_CONCURRENCY` (1) at a time; watch the oldest wait fall.
3. A rescan campaign adds prioritised jobs to the same queue. If one is running and uploads are
   waiting behind it, pause the campaign (Scan Diagnostics › Rescan campaigns, with a reason).
4. If the worker is running, the queue is not moving and nothing explains it, read the worker's log
   and restart it.

### `PUBLICATION_QUEUE_LAG`

1. Is `FAILED_JOBS` open? Publication jobs that fail five times go there; see
   [Failed jobs](failed-jobs.md).
2. Read the backend's log for `AssetPublicationProcessor` errors. Publication talks to Cloudflare
   Images; a Cloudflare outage or a revoked `cloudflareImagesGatedApiKey` stops it.
3. If publication must not happen while you find out, pause it (see
   [Incidents](incidents.md#contain)). Pausing clears this alert, and `PUBLICATION_PAUSED_LONG`
   takes over after an hour.

### `WORKER_SILENT`

1. Check the worker service on Render: is it running, deploying, crashed or suspended?
2. Read its log. The container stops if its migrations fail or the worker process exits. A line
   `Heartbeat not recorded` means it is running but cannot write its row: check its database
   connection.
3. If Scan Diagnostics says the heartbeat cannot be read, the backend cannot read the worker's
   view: the worker's migrations may not have run, or the backend's role lost its grant
   (`BACKEND_DB_ROLE`).
4. A worker build from before FC-042 writes no heartbeat, so this alert stays open while one is
   deployed.
5. Uploads wait while it is silent; none is published unscanned.

### `WORKER_PAUSED`

1. Read the pause reason on Scan Diagnostics or in the heartbeat
   ([Pause reasons](readiness-and-heartbeats.md#pause-reasons)).
2. `SIGNATURES_TOO_OLD`: follow [Scanner signatures](scanner-signatures.md#when-freshclam-is-failing).
3. `SCANNER_UNREACHABLE` for ten minutes: `clamd` is down or not loading. Read the worker's log and
   restart the worker.
4. Paused with no reason: the resume did not take. Restart the worker.

### `SIGNATURES_STALE`

Follow [Scanner signatures](scanner-signatures.md#when-freshclam-is-failing). There are twelve
hours before the worker stops.

### `FAILED_JOBS`

Follow [Failed jobs](failed-jobs.md). The alert counts every failed job, retryable or not, and
clears once each has been retried or discarded.

### `PUBLICATION_PAUSED_LONG`

1. Find who paused it and why: the Publication panel on the Admin page shows since when, and the
   Security Log has the `PUBLICATION_PAUSED` entry with who and why.
2. If the reason still holds, leave it; the alert stays open until publication resumes, and that
   is the point of it.
3. If not, resume publication with a reason. Everything held publishes.

### `QUEUES_UNREACHABLE`

Redis carries every queue, so while it is down nothing is queued, scanned or published, and no
background job runs. Notifications are database rows, so this one reaches you without Redis.

1. Check the Redis service on Render (`REDIS_URL`): is it running, restarting or out of memory?
   Check Render's status.
2. Read the backend's log for `[probeQueues] Redis did not answer` — once a minute while it lasts.
3. While it lasts, the other queue alerts (`SCAN_QUEUE_LAG`, `PUBLICATION_QUEUE_LAG`,
   `FAILED_JOBS`) are not judged and stay as they were. Scan Diagnostics still loads, within about
   five seconds: its queue counts and the publication queue's part are shown as unreachable
   (`null`), the failed-jobs list and its Retry and Discard buttons answer 503 "The job queues
   cannot be reached.", and a publication pause still works (below). The rest of the API serves
   too, with its rate limits counted in each instance's memory until Redis answers (the log says
   `Rate limits counted in memory while Redis cannot answer`, and later
   `Rate limits counted in Redis again`), so each instance allows its full limit on its own.
   **Uploads are accepted and queued later.** An upload is stored in quarantine and answered as
   usual within about five seconds, showing as "waiting to be scanned"; the backend logs
   `[requestScan] Could not queue a scan; it will be queued when the queue answers`. Once Redis
   answers, the re-queue sweep sends every such upload within a few minutes
   (`[requeue] Scan requests queued again - Count: n`), and they are scanned and published as
   usual. The nightly sweep does not abandon uploads while this alert is open or for a day after
   it clears.
4. When Redis comes back, the alert clears at the next minute's run. A new Redis knows nothing of
   a publication pause; the switch in the database is re-applied at that run. If Redis lost its
   data, the worker resends stranded verdicts as it starts, and the backend's re-queue sweep sends
   again every scan request that was lost with it; see [Failed jobs](failed-jobs.md).

The two minutes are counted in the backend's memory across consecutive runs, so a backend restart
during an outage starts them again. Readiness (`/health/ready`) does not depend on Redis and stays
as it is.

### `PURGE_OWED`

Withdrawing a published picture revokes its row and then deletes it from Cloudflare (ADR-0016).
When the delete fails, the purge is owed (`purgeRequiredAt` set, `purgedAt` empty) and the picture
is still reachable at its old address, on every variant. Every hour the owed-purge sweep asks
Cloudflare again for each, oldest first, 50 at a time, and an object Cloudflare no longer has counts
as gone (`[sweep] Owed purges retried - Purged: p, Failed: f`). The alert opens once one has been
owed for a day, and needs only the database, so it is judged while Redis is down too.

1. Open Scan Diagnostics: under Publication it counts the withdrawn pictures still to be deleted,
   how many are over a day, and how old the oldest is.
2. Read the backend's log for `[deleteFromCloudflare] Could not delete - Reference: …, Reason: …`.
   A 401 or 403 is the Cloudflare token (`cloudflareImagesGatedApiKey`, or the R2 pair for a legacy
   picture): check it in AWS Secrets Manager and Cloudflare. A 5xx or a timeout is Cloudflare:
   check its status page and wait for the next hourly run.
3. The alert clears at the next minute's run once nothing has been owed for a day.

## What raises no alert

- **The backend down.** The alerts run in the backend. Render's own health check and deploy status
  are what show it.
- **The image estate and rescan campaigns.** Their failures are recorded on their own runs and
  shown on their own panels, not in the failed set.
