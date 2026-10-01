# Incidents: the fail-closed procedure

What to do when something is wrong with the file pipeline, the database or a secret, and you are
not yet sure what. Five steps: recognise, contain, diagnose, recover, record. The rule throughout
is the one the code already follows: **when in doubt, stop publication; never open quarantine.**

- [Recognise](#recognise)
- [Contain](#contain)
- [Diagnose: authorised diagnostics](#diagnose-authorised-diagnostics)
- [Recover](#recover)
- [Record](#record)

## Recognise

Any of these starts an incident:

- **An operations alert**: a `WARNING` notification to every site admin. Each alert and its first
  steps are in [Alerts](alerts.md).
- **Scan Diagnostics** showing something wrong: a silent or paused worker, old signatures, a
  growing queue, uploads awaiting a verdict that do not move, failed jobs, publication paused,
  Redis unreachable (`QUEUES_UNREACHABLE`).
- **The logs on Render**: `Restore check failed` in the backend's (the API is not starting);
  `IRG01` (something tried to write a picture the registry has not published — an old build, or a
  bug); `Heartbeat not recorded` or `freshclam` errors in the worker's.
- **A report from a person**: a picture that should not be there, a file that was refused and
  should not have been, a suspected leak of a credential.

## Contain

Take the smallest step that stops the harm. Each one fails closed: uploads wait, nothing
unscanned is published.

1. **Pause publication** when the worry is what is being published: the Publication panel on the
   Admin page (`POST /admin/file-publication/pause`), with a reason. Uploads are still accepted and scanned;
   nothing is published until it is resumed, and then everything held publishes. A job already
   running finishes. The pause is written to the database and applied to the queue at once, again
   at startup and at every minute's alert run, so a lost Redis does not undo it.
   `PUBLICATION_PAUSED_LONG` opens after an hour, as a reminder. See
   [File assets](../file-assets.md#pausing-publication).

   **Pausing works while Redis is down.** The switch is written to the database first and is the
   authority. The answer comes within about six seconds (five of the queue giving up, and about
   one more the first time the rate limiter finds Redis gone) with `queuePaused` null: the queue itself
   will be paused at the first minute's run once Redis answers, and until then nothing is published
   — the queue hands out no jobs while Redis is down, and a job handed out before the queue is
   paused sees the switch and puts itself back. Resuming works the same way.

2. **Stop the worker** when the worry is the scanner itself: suspend the worker service on Render.
   Nothing is scanned, so nothing new is cleared. `WORKER_SILENT` opens. Uploads wait in the queue.
   The nightly sweep abandons nothing while the worker is silent or paused, or publication is
   paused, and counts its 24 hours from when things started again (see
   [File assets](../file-assets.md#uploads-nothing-comes-back-for)), so a long stop costs no
   uploads — but people are waiting, so do not leave it stopped without a reason.
3. **Switch a feature off** when the worry is one feature. `FLEET_COMMUNITIES_ENABLED`,
   `CUSTOM_TRACKING_ENABLED` and `STORYTIME_ENABLED` are runtime switches in `app_setting`; each
   instance sees a change within ten seconds. Storytime's has an admin route,
   `PATCH /admin/storytime/configuration`; the others are an `UPDATE` in SQL, which is not in the
   Security Log — record it. No feature switch touches the file gate, and none needs to.
4. **Take a picture down** through the feature that shows it: Custom Tracking and Storytime
   moderation, or a rescan finding (take down, with a reason). There is no site admin route to
   withdraw a picture by its ID alone.
5. **Revoke a secret** you think has leaked. Revoke it at the provider (Cloudflare, AWS, SendGrid),
   put the new value in the AWS secret, and redeploy the service that reads it: both applications
   read their secret once and keep it for the life of the process. See
   [Security](../security.md#secrets-management-policy-silvergold) and the key list in
   [Render services](render-services.md#secrets). Every quarantine credential is a production
   credential, whichever environment issued it.

Do not work around a fail-closed state to make the site look healthy: do not raise
`CLAMAV_MAX_DEFINITION_AGE_HOURS`, skip the restore check, or point a service at another
environment's database.

## Diagnose: authorised diagnostics

**While Redis is down** (`QUEUES_UNREACHABLE`), every Redis read behind Scan Diagnostics gives up
after five seconds rather than waiting for Redis: the queue counts and the publication queue's
state show as unreachable, the failed-jobs list answers 503 "The job queues cannot be reached.",
and Retry, Retry all, Discard and Discard unretryable answer the same 503 rather than hang. A
"Retry all" or "Discard unretryable" that Redis stops answering part way logs what it did before
saying so. Everything else on the page — the heartbeats, alerts, refusals and assets — is in the
database and reads as usual. Uploads are still accepted, stored in quarantine and answered as usual,
showing as "waiting to be scanned" (`RETRY_PENDING`); the backend queues their scans once Redis
answers, so there is nothing to do for them. The page is reachable at all because the API's rate limits are
counted in each instance's memory while Redis cannot answer (`Rate limits counted in memory while
Redis cannot answer` in the backend's log, then `Rate limits counted in Redis again`); see
[Backend](../backend.md#when-redis-cannot-answer-fc-042). The rehearsal measured about six seconds
for the page and five for the failed-jobs list's 503 ([Rehearsal](rehearsal.md#timings)).

Steve's decisions of 30 September 2026: the diagnostics stay `ADMIN` only, and every read of them
is logged.

- **Who.** Site admins only: every diagnostics route needs the `ADMIN` role.
- **Logged, one entry per page view.** Each view of Scan Diagnostics writes one
  `SCAN_DIAGNOSTICS_VIEWED` entry to the Security Log: the diagnostics read logs it, and the first
  page of refusals and of failed jobs read with it do not. A later page of either, a failed-jobs
  list for one queue, and one asset's outcome (`GET /admin/file-scanning/assets/:assetId`) each log
  their own entry. A read that finds no asset writes nothing. See
  [Admin audit](../admin-audit.md#operations-fc-042).
- **What the diagnostics show.** Counts, codes, versions and ages: usage, the engine and its
  signatures, the queue, the uploads awaiting a verdict, the worker heartbeats, the open alerts,
  the publication pause, and per asset its kind, state, rejection code, engine, signature and
  policy versions, and when it was uploaded and judged. Never a signature name, a file name or a
  job's data; a failed job's error is reduced to a code.
- **Scanner detail stays with admins.** The person who uploaded a refused file is told only that it
  was not accepted. Do not tell them which rule or signature matched: that tells somebody probing
  the scanner what gets through.
- **The logs.** The backend's and the worker's logs on Render carry the full error text that the
  diagnostics reduce to a code. The worker never logs a file name or content.
- **The database.** The heartbeat query in
  [Readiness and heartbeats](readiness-and-heartbeats.md#reading-the-heartbeat) is safe to run.
  Read the worker's schema only through the views the backend's role is granted.

Three things are never done, in an incident or out of one:

1. **Never download quarantined bytes.** Nothing in the application serves them, and nobody should
   fetch them from the bucket with a console or a client. An object in quarantine is by definition
   one nobody has cleared; it may be the malware the incident is about.
2. **No raw officer CSVs anywhere.** A roster export straight from the game carries Officer
   Comment columns — private notes about named players — which the application discards before
   anything is stored. If somebody sends one in to show a problem, do not attach it to a ticket,
   paste it into a chat or save it; ask for the problem to be described instead.
3. **No secret values** in a ticket, a log, a chat or the incident record. Key names only.

## Recover

1. **Fix the cause** first: signatures fresh, worker running, Cloudflare answering, secret
   replaced, bad release rolled forward ([Rollback](rollback.md)).
2. **Resume what you stopped**, in reverse order: the worker (it resends stranded verdicts as it
   starts), then publication (the Admin page's Publication panel, with a reason; everything held
   publishes), then any feature switch.
3. **Deal with the failed jobs**: retry what can be retried, discard what cannot, each with a reason
   ([Failed jobs](failed-jobs.md)).
4. **Watch the alerts clear.** Each sends every site admin an `INFO` notification as it goes.
5. **If the database itself was the problem**, follow [Restore](restore.md).

## Record

Write the incident up while it is fresh.

> TODO: Confirm with Steve where incident records are kept.

What to write down:

- **When**: when it started, when it was noticed, when it was contained, when it was over, in UTC.
- **What was seen**: which alerts opened and cleared (Scan Diagnostics and the notifications have
  the times), the log lines that mattered, and the counts.
- **What was done, by whom and why**: each pause, resume, retry, discard and switch. Those taken
  through the site are in the Security Log with their reasons; copy them into the record, because
  the Security Log deletes entries after `AUDIT_DATA_NUKE_THRESHOLD_DAYS`. Anything done in SQL, on
  Render, in AWS or in Cloudflare is not in the Security Log: write each one down.
- **What people saw**: uploads refused, delayed or abandoned, pictures missing.
- **Credentials**: which were revoked and replaced, and when. Never the values.
- **After a restore**: the backup's moment, the restore check's summary line, the
  `LEDGERS_RECONCILED` counts, including the accounts it closed again.
- **What to change**, so it does not happen again, as stories.
