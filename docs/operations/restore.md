# Restore

Restoring the database from a backup, and what the site does about everything the backup is
missing. The acceptance criterion this answers: a restore reapplies erasures, holds and asset
denies before anything is served. Account closures are reapplied too.

- [Before you start](#before-you-start)
- [The restore](#the-restore)
- [What the boot does by itself](#what-the-boot-does-by-itself)
- [What is not brought back](#what-is-not-brought-back)
- [Redis and the queues](#redis-and-the-queues)
- [Checking it worked](#checking-it-worked)

## Before you start

- **The plan and its backups are to confirm on Render (FC-052).** Which plan production is on, how
  long its backups are kept and whether point-in-time recovery is available are not known yet;
  see [Render services](render-services.md#to-confirm-on-render-fc-052). This runbook assumes the
  restore produces a **new** database, leaving the old one in place. The dashboard steps
  (suspending a service, restoring, pointing a service at a new database) are rehearsed on Render
  in FC-052.
- **One database, two schemas.** The backend's `sto_info_app` and the worker's `sto_info_worker`
  are in the same database, so both go back to the backup's moment together. Each application's
  role must exist in the restored database with the password in its secret (`dbPassword`).
- **The ledgers are not restored, and must not be.** They are objects in the private quarantine
  bucket, under `<NODE_ENV>/erasure-ledger/`, `<NODE_ENV>/hold-ledger/`,
  `<NODE_ENV>/asset-deny-ledger/` and `<NODE_ENV>/account-closure-ledger/`. The bucket has no
  expiry rule. Never add one to those prefixes, and never delete a marker: they are what makes a
  restore safe.
- **Only an FC-042 build has the restore check.** Never restore under a build from before FC-042;
  see [Rollback](rollback.md).
- **Never point one environment at another's database.** The ledgers are chosen by `NODE_ENV`, so
  a backend would compare its own environment's ledgers with the wrong database, and could delete
  delivered pictures that the other environment's markers name.

## The restore

1. **Decide the moment** to restore to, and write it down with the reason
   ([Incidents](incidents.md#record)).
2. **Note the switches you have set during the incident**: the publication pause
   (`GET /admin/file-publication`) and any feature switch you turned off. The restored database
   holds whatever they were at the backup's moment.
3. **Stop both applications writing to the old database.** Suspend the backend and the worker on
   Render. Nothing is published while the worker is stopped, and uploads cannot be taken while the
   backend is.
4. **Create the restored database** from the backup, as a new database. Keep the old one: it holds
   what happened after the backup — Security Log entries, for one — and the incident record may
   need it.
5. **Check the roles and grants** in the restored database: the backend's role and the worker's
   (each service's `DB_USERNAME`) both exist and can sign in with their secrets' `dbPassword`, and
   the backend's role can still read the worker's `worker_heartbeat_status` view.
6. **Set the switches the backup got wrong** before the backend starts, in the restored database.
   If publication must stay paused and the backup says it is running:

   ```sql
   UPDATE "sto_info_app"."app_setting"
   SET "value" = json_build_object('paused', true, 'pausedAt',
     to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text
   WHERE "key" = 'FILE_PUBLICATION_PAUSED';
   ```

   A feature switch is `UPDATE "sto_info_app"."app_setting" SET "value" = 'false' WHERE "key" = '…'`
   (`FLEET_COMMUNITIES_ENABLED`, `STORYTIME_ENABLED`, `CUSTOM_TRACKING_ENABLED`). A change made in
   SQL is not in the Security Log: record it in the incident record.

7. **Point both services at the restored database**: `DB_HOST`, `DB_PORT`, `DB_NAME` and
   `DB_USERNAME` on the backend and on the worker. The passwords are in the AWS secrets, not on
   Render.
8. **Start the backend first.** `start:render` runs its migrations — any added since the backup —
   and then the restore check. Watch its log for `[reconcile] Restore check finished - …`. Until it
   appears, the API does not listen; if `Restore check failed` repeats, fix what its `Reason` names
   ([Readiness and heartbeats](readiness-and-heartbeats.md#the-backend)).
9. **Then start the worker.** Its migrations run, and it resends stranded verdicts as it starts.
10. **Check it worked**, below.

## What the boot does by itself

At every boot — not only after a restore — `RestoreCheckService` compares the four ledgers with
the database before the API serves anything. The detail is in
[Privacy: erasure](../privacy-erasure.md#the-restore-check-fc-042); in short:

- **When.** `main.ts` runs it after the application is built and before `app.init()`. No route,
  socket, queue worker or scheduled job starts until it finishes, and `/health/ready` cannot
  answer, so Render does not send traffic.
- **What it reads.** Each ledger's keys, listed once:

  | Ledger           | Key, under `<NODE_ENV>/`                                                    | Brought back                                                                                                                                                                                                                                                                                                       |
  | ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Erasures         | `erasure-ledger/<createdAt>_<erasureId>.json`                               | The erasure made again: the pair found by hashing, anonymised, its files deleted, recorded as replayed with no admin                                                                                                                                                                                               |
  | Hold events      | `hold-ledger/<createdAt>_<actionId>_<PLACED\|EXTENDED\|RELEASED>.json`      | Each event the log lacks, under its own ID and time, oldest first — see [Fleet chat](../fleet-chat.md#the-hold-ledger-fc-042)                                                                                                                                                                                      |
  | Asset denies     | `asset-deny-ledger/<createdAt>_<assetId>_<REJECTED\|REVOKED\|DELETED>.json` | The deny: a served picture withdrawn and deleted from Cloudflare, an unserved upload refused or discarded, a picture the database does not know deleted from Cloudflare — see [File assets](../file-assets.md#the-asset-deny-ledger-fc-042)                                                                        |
  | Account closures | `account-closure-ledger/<createdAt>_<userId>_<CLOSED\|REOPENED>.json`       | The closure: an account the database has open closed again as its owner closed it — Communities handed on or closed, sessions revoked, data soft-deleted — as of when they did, so the nightly clean-up erases it on time; no email is sent again — see [Backend](../backend.md#the-account-closure-ledger-fc-042) |

- **Cheap.** It compares the IDs in the keys with the database, 500 rows at a time, and reads a
  marker's body only when the database lacks what it is about, and never an account closure's.
- **Backfill.** Anything the database has and a ledger lacks gets a marker, eight at a time, so the
  ledgers are complete after the first FC-042 boot, and again after any time an older build ran.
- **One at a time.** It holds the PostgreSQL advisory lock `1797200000`. A second instance waits,
  then finds nothing left to do.
- **Fail closed.** If the bucket or the database cannot be reached, it logs
  `[run] Restore check failed; the API waits for it - Attempt: n, RetryInMs: t, Reason: …` and
  tries again after 1 second, doubling to 60, for as long as it takes.
- **Logged.** One line per ledger, and the summary
  `[reconcile] Restore check finished - Erasures: m/r/b, Holds: m/r/b, Assets: m/r/b, Closures: m/r/b, ListMs: …, CompareMs: …, ReplayMs: …, BackfillMs: …`
  (markers, replayed, backfilled). When anything came back, a `LEDGERS_RECONCILED` entry in the
  Security Log with no actor, such as "The restore check brought back 2 erasures, 1 hold event,
  3 denied uploads and 1 account closure.", with each ledger's counts in its detail.
- **A Cloudflare failure** deleting a picture the database does not know is logged and tried again
  at the next boot; it does not hold the API back, because nothing in the database can serve it.

## What is not brought back

Steve's decisions of 30 September 2026: only erasures, holds, asset denies and account closures
have ledgers.

- **Retention purges.** Rows purged after the backup come back, and are forgotten again before the
  API serves (Steve's decision of 1 October 2026, FC-043). After the ledgers, the restore check runs
  every Fleet retention job that forgets by age — roster files, scoped news, retracted Character
  Fleet memberships, chat messages, chat reports, transcripts and activity — round after round until
  each says it is done, each run recorded as on its schedule. Holds are replayed first, so what a
  hold keeps is still kept. A job that fails fails the check, which waits and tries again like any
  other failure. The summary line ends `RetentionMs: …, Forgotten: CHAT_MESSAGES messages=n; …`
  (or `Forgotten: nothing`). The site-wide jobs below are not Fleet data and are left to their
  schedules:

  | Job                                                                                                 | Runs (UTC)               |
  | --------------------------------------------------------------------------------------------------- | ------------------------ |
  | Audit, login attempts, contact requests, SES audit, closed accounts, Custom Tracking, stale uploads | Daily at 00:00 and 03:26 |
  | Activity (twelve months)                                                                            | Daily at 03:41           |
  | Scoped news and retracted Character Fleet memberships (30 days)                                     | Daily at 04:05 and 04:07 |
  | Roster files (180 days)                                                                             | Daily at 04:11           |
  | Chat messages (45 days)                                                                             | Daily at 04:23           |
  | Chat reports (90 days after closing)                                                                | Daily at 04:41           |
  | Moderation hold reviews and system releases                                                         | Daily at 05:03           |
  | Retention run records (a year)                                                                      | Daily at 05:11           |
  | Chat transcripts (24 hours)                                                                         | Hourly                   |

  So what the site-wide jobs purged comes back for at most a day; nothing of the Fleet's does.
  The bytes those purges deleted from the buckets stay deleted: buckets are not restored.

- **Account closures are brought back** (above), so they are not in this list. An account closed
  before the backup and erased after it comes back closed, and the nightly clean-up erases it
  again. An account closed after the backup, by a build from before the closure ledger, has no
  marker and comes back open: if an older build ran after the backup (a rollback), compare the old
  database's closed accounts (`deletedAt` on `user`) with the restored one's.

- **Everything else written after the backup** — posts, uploads, settings, Security Log entries —
  is gone from the restored database. Uploads published after the backup are orphans in
  Cloudflare Images: the database has no row for them. An image estate inventory lists them (see
  below).

## Redis and the queues

Redis is not restored. It still holds whatever was queued before the restore, and knows nothing
the restored database has forgotten.

- **Queued jobs about records the database lacks** do nothing or fail, because every job reads
  its record when it runs. Those that fail reach the failed set, where the list marks them not
  retryable; discard them with a reason ([Failed jobs](failed-jobs.md)).
- **Verdicts.** The worker's attempts went back with the database. Attempts the restored database
  shows finished but unsent are resent by the worker at start and every ten minutes; verdicts
  still in Redis for attempts the database no longer has are checked against the registry and
  refused unless the upload is still `SCANNING` the same object.
- **Uploads stuck in `SCANNING` or `RETRY_PENDING`** with no job left to move them are shown on
  Scan Diagnostics as awaiting a verdict. Nothing requeues them. The nightly
  `StaleUploadSweepService` abandons any upload whose placement has waited more than 24 hours and
  deletes its quarantined bytes; the person uploads it again.
- **The publication pause** is re-applied from the database to the queue at startup and every
  minute, so whatever the Redis queue's paused flag says, it follows the restored switch within a
  minute.

## Checking it worked

1. **The API is up.** `GET /health/ready` answers 200.
2. **The restore check ran.** The backend's log has the `Restore check finished` line. Replayed
   counts above nought mean the backup was missing something, as expected for an older backup.
3. **The Security Log** shows a `LEDGERS_RECONCILED` entry, with the same counts, if anything came
   back.
4. **Roster erasures.** Admin › Roster Erasures shows each replayed erasure as replayed from the
   ledger, with no admin.
5. **The worker.** Scan Diagnostics shows it `RUNNING` and no `WORKER_SILENT` alert.
6. **Failed jobs.** Discard the ones about records the restore removed; retry the rest.
7. **Uploads awaiting a verdict.** Note the counts. Any that do not move will be swept within a day.
8. **Pictures.** Take an image estate inventory (Scan Diagnostics › Image estate, "Take an
   inventory"). Orphans are uploads made after the backup; missing pictures are ones the restored
   database expects and Cloudflare no longer has. See
   [Private image delivery](../image-delivery.md#the-inventory).
9. **The switches.** The publication pause and the feature switches are as you intended.
10. **Record it**: the backup's moment, the counts from the summary line (the closures among
    them), and every change made in SQL.
