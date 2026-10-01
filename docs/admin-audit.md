# Admin audit and the Security Log (FC-039)

What site admins did, why, and what the system did on its own, recorded where
somebody can read it later. This is the record a site admin answers to: every
site-level admin action takes a reason, and the reason is kept with the action
in the same transaction that makes the change.

Steve's decisions of 29 September 2026:

| Question | Decision |
| -------- | -------- |
| Where site admin actions are kept | A new write-once table, `site_admin_action`, kept like `_audit` |
| What it records | Roles and permission and limit overrides; disabling and enabling accounts; report decisions (member and chat, including those closed by a disabling); content moderation (Custom Tracking and Storytime) |
| The Fleet logs | Kept for the life of their scope and readable only by those who run it; documented as history |
| How admins read it | A Security Log page that also shows the other logs admins act in, and the retention runs |
| Scan outcomes | An admin may see why an upload was refused: the rejection code and the engine, never a signature name |
| Bulk endings | One governance row for each role or grant ended |
| Retried jobs | Idempotency keys with unique indexes, so a retry writes nothing twice |
| Merging an unregistered Fleet | Left to a later story |

## The site admin log

`site_admin_action` holds one row for each site-level admin action. Each row
records:

| Column | What |
| ------ | ---- |
| `action` | What was done: `site_admin_action_enum` |
| `actorUserId` | The site admin; `SET NULL` when their account goes; null for what the system did itself (`LEDGERS_RECONCILED`) |
| `targetUserId` | The account acted on, if any; `SET NULL` when it goes |
| `subjectKind`, `subjectId` | The record acted on, when not an account: both or neither |
| `reason` | Why, required and non-blank, up to 1,000 characters (a Storytime creator's message can be that long) |
| `detail` | Codes, states and IDs only, never anything a person wrote |
| `ipAddress` | The request's, when there was one |
| `createdAt` | When |

| Action | Written by | Reason from |
| ------ | ---------- | ----------- |
| `USER_ROLE_CHANGED` | `PUT /admin/access-control/users/:userId/role` | `reason` in the body; `detail` has `from` and `to` |
| `PERMISSION_OVERRIDE_SET`, `PERMISSION_OVERRIDE_REMOVED` | The permission override routes | The override's `reason`; `{ reason }` in the `DELETE` body |
| `LIMIT_OVERRIDE_SET`, `LIMIT_OVERRIDE_REMOVED` | The limit override routes | The same |
| `USER_DISABLED`, `USER_ENABLED` | `POST /admin/moderation/users/:id/disable` and `/enable` | `reason` in the body, now required for both |
| `USER_REPORT_DECIDED` | `PATCH /admin/moderation/reports/:id`, and each open report a disabling closes | `reason`, required to close a report; a claim is logged as "Taken for review." |
| `CHAT_REPORT_DECIDED` | `POST /admin/chat-reports/:id/decision`, and each open chat report a disabling closes | `note`, now required |
| `CUSTOM_TRACKING_SUPPRESSED`, `CUSTOM_TRACKING_RESTORED` | `POST /admin/moderation/custom-tracking/:level/:id/suppress` and `/restore` | `reason` in the body; `targetUserId` is the owner |
| `STORYTIME_CONTENT_REMOVED`, `STORYTIME_CONTENT_RESTORED`, `STORYTIME_REPORT_DECIDED`, `STORYTIME_APPEAL_DECIDED` | Storytime moderation | What the creator is told, or the resolution; a resolution is required to close a report and review notes to decide an appeal |
| `IMAGE_COPY_STARTED`, `IMAGE_UNDO_STARTED`, `IMAGE_RETIRE_STARTED`, `IMAGE_RUN_PAUSED`, `IMAGE_RUN_RESUMED` | The image estate's runs, on Scan Diagnostics (FC-040) | `reason` in the body; the subject is the run — see [Private image delivery](image-delivery.md) |
| `RESCAN_STARTED`, `RESCAN_PAUSED`, `RESCAN_RESUMED`, `RESCAN_CANCELLED` | Rescan campaigns, on Scan Diagnostics (FC-041) | `reason` in the body; the subject is the campaign, and `detail` holds a new campaign's selection — see [Rescan campaigns](rescan-campaigns.md). The nightly legacy campaign is the system's, and is not logged here |
| `IMAGE_TAKEN_DOWN`, `IMAGE_KEPT` | `POST /admin/rescan-campaigns/findings/:rescanId/decision`, on a picture refused for policy on rescan (FC-050) | `reason` in the body; the subject is the asset (`FILE_ASSET`), `targetUserId` its owner, and `detail` the rescan and its code |
| `CHAT_MESSAGE_REMOVED` | `POST /admin/chat-reports/:reportId/remove-message` (FC-050) | `reason` in the body; the subject is the report, `targetUserId` the message's author, and `detail` the message. Chat's own log records it too, as `MESSAGE_REMOVED` |
| `LEDGERS_RECONCILED` | The restore check at boot, when it brought anything back (FC-042) | No actor. The reason counts what came back, such as "The restore check brought back 2 erasures, 1 hold event and 3 denied uploads."; `detail` has each ledger's counts — see [Privacy: erasure](privacy-erasure.md#after-a-restore) |
| `SCAN_DIAGNOSTICS_VIEWED` | Every view of Scan Diagnostics: `GET /admin/file-scanning/diagnostics`, `/rejections` after the first page, `/failed-jobs` after the first page or for one queue, and `/assets/:assetId` (FC-042) | A fixed sentence, such as "Read Scan Diagnostics"; the subject is `DIAGNOSTICS`, `REJECTIONS`, `ASSET` or `FAILED_JOBS`, with the asset's ID for `ASSET` and `ALL` otherwise; `detail` has the page, and the queue for failed jobs |
| `SCAN_JOB_RETRIED` | `POST /admin/file-scanning/failed-jobs/:queue/:jobId/retry` and `/retry-all` (FC-042) | `reason` in the body; the subject is the queue and the job ID, with `detail` its attempts, or for "Retry all" the queue (or `ALL`) and `ALL`, with `detail` the counts retried and skipped by queue |
| `SCAN_JOB_DISCARDED` | `POST /admin/file-scanning/failed-jobs/:queue/:jobId/discard` and `/discard-unretryable` (FC-042) | `reason` in the body; the subject is the queue and the job ID, with `detail` its attempts and whether a retry could have helped, or for "Discard unretryable" the queue (or `ALL`) and `ALL`, with `detail` the counts discarded and kept by queue |
| `PUBLICATION_PAUSED`, `PUBLICATION_RESUMED` | `POST /admin/file-publication/pause` and `/resume` (FC-042) | `reason` in the body; no subject; a resume's `detail` has how many minutes it was paused |

The row is written by `recordSiteAdminAction()` in the transaction that makes
the change, so a change never lands without its entry and an entry never
stands for a change that rolled back. The audit subscriber does not copy these
rows into `_audit`: they are an audit record already.

### Write-once, and how long it is kept

A trigger refuses any change to a row, except the three the audit policy
needs: an account it names going (`actorUserId` or `targetUserId` set to
null) and its IP address being forgotten. PostgreSQL raises `23514`.

The row is kept under the audit policy, by the same nightly job as `_audit`:
the IP address is nulled after `AUDIT_IP_NUKE_THRESHOLD_DAYS` and the row is
deleted after `AUDIT_DATA_NUKE_THRESHOLD_DAYS`.

## The Fleet logs, as history

The logs a Fleet Community keeps about itself are its history, not an audit
trail that runs out:

- `scope_governance_action`: roles, capabilities, ownership, closures and
  disputes;
- `scope_membership_action`: applications, invitations, suspensions and
  departures;
- `fleet_roster_import_action`: what happened to each roster import;
- `chat_action`: channels, message removals and transcripts;
- `moderation_hold_action`: the site admins' holds on chat evidence.

Each is kept for as long as its scope exists and is read only through the
routes of those who run it (the Owner and Admins, for governance) or, for
holds, the site admins'. What site admins did in them also shows in the
Security Log. None holds content: reasons and purposes are the actor's own
words.

### Endings nobody chose

When a closure, a departure, a hand-over or an Armada rearrangement ends the
roles and capability grants somebody held, `endAndLog()` ends each one and
writes a `ROLE_WITHDRAWN` or `CAPABILITY_CLEARED` row for it with no actor and
a reason naming the cause, such as "Ended when they left the Fleet." The
history then shows every role that went and why. The governance history marks
these rows `automatic`, and the page says what ended rather than who ended it.

## Retries write nothing twice

A job or scheduled run can be retried after it has already written. Each log
such a job writes to has an `idempotencyKey`, unique where it is set
(`UX_<table>_idempotency`), and the write is an insert that ignores a clash:

| Log | Key | Written by |
| --- | --- | ---------- |
| `scope_governance_action` | `ENDED:<role or grant id>` | `endAndLog()` |
| `chat_action` | `TRANSCRIPT_READY:<id>`, `TRANSCRIPT_FAILED:<id>`, `TRANSCRIPT_EXPIRED:<id>` | The transcript job and sweep |
| `moderation_hold_action` | `REVIEW_DUE:<id>:<reviewAt>`, `RELEASE_WARNED:<id>:<reviewAt>`, `RELEASED:<id>` | The hold review |
| `fleet_roster_import_action` | `SOURCE_EXPIRED:<importId>`, `SOURCE_ERASED:<importId>` | Roster file retention and erasure |

What a person does has no key: each act is its own. The transcript outcomes
are new chat actions in FC-039, so the chat log now says when a transcript was
written, given up on or expired, as well as asked for and downloaded.

## The Security Log

`GET /admin/security-log?source=&page=` (`ADMIN` only) is one feed, newest
first, fifty to a page, read from the logs that already hold each entry:

| Source | From | What it shows |
| ------ | ---- | ------------- |
| `SITE_ADMIN` | `site_admin_action` | Every site admin action |
| `FLEET` | `scope_governance_action` where `asSiteAdmin` | A site admin's dispute actions in a Fleet Community |
| `HOLD` | `moderation_hold_action` | Placing, extending, releasing and reading holds, and the system's notices |
| `INVESTIGATION` | `fleet_investigation_grant` | A site admin's look into a Fleet, and its purpose |
| `ERASURE` | `roster_erasure` | Roster erasures and their replays |
| `RETENTION` | `retention_run` | Each Fleet retention run, its counts and any failure |

Each entry gives who, when, what, to whom or what, and why. The feed keeps
nothing of its own, so each entry lasts as long as its source keeps it. Every
source names every column itself, so asking for one source alone reads the
same shape as asking for all of them.

## Why an upload was refused

`GET /admin/file-scanning/rejections?page=` lists refused assets, newest
verdict first, 25 to a page. `GET /admin/file-scanning/assets/:assetId` reads
one asset's outcome. Both are `ADMIN` only and answer the same shape: the
asset's kind and state, its rejection code, the engine and signature versions
and the policy version behind the verdict, and when it was uploaded and
judged. There is no signature name: the worker never records one, because
naming what matched tells somebody probing the scanner what gets through. The
uploader is only ever told the file was not accepted.

## Operations (FC-042)

Steve's decisions of 30 September 2026: Scan Diagnostics stays `ADMIN` only, and every view of it
is logged as `SCAN_DIAGNOSTICS_VIEWED` with a fixed reason — one entry per page view. The page
reads the diagnostics, the first page of refused assets and the first page of failed jobs when it
opens and on Refresh; it does not poll. So the diagnostics route logs, and the other two log only
a deliberate read: a later page, or for failed jobs one queue chosen. One asset's outcome logs its
own read; a read that finds no asset writes nothing.

**Rolling back.** Migration `1797500000000` refuses its `down` once the log holds any of these
five actions: removing them would lose Security Log history, so the answer is to roll forward.
Nothing is deleted.

Retrying or discarding a failed job and pausing or resuming publication each take a reason, like
every other site admin action. They appear in the Security Log under `SITE_ADMIN` with the rest; no filter was added.
See [File assets](file-assets.md#running-the-pipeline-fc-042).

## Not done here

Merging an unregistered Fleet into a registered one was left to a later story.
