# Privacy: erasure, departures and telemetry

How the Fleet Community meets privacy claims (FC-038, R06, R10, R23, R27 and R29). The decisions
below are Steve's, from 29 September 2026.

- [Unlinking is not erasure](#unlinking-is-not-erasure)
- [Verified roster erasure](#verified-roster-erasure)
- [Staying erased](#staying-erased)
- [After a restore](#after-a-restore)
  - [The restore check (FC-042)](#the-restore-check-fc-042)
- [An Owner closing their account](#an-owner-closing-their-account)
- [Erasing a closed account](#erasing-a-closed-account)
- [Telemetry](#telemetry)
- [Routes](#routes)

## Unlinking is not erasure

A player who says No to a Character Fleet proposal, leaves a Fleet or removes a membership changes
only what their Character's page says. A Fleet's roster still lists the name it imported. The
Character's Fleet panel says this, and points to Contact us for erasure. Unlinking erases nothing;
erasure is a separate, verified request.

## Verified roster erasure

A person listed in any Fleet's roster, with or without an account here, can ask through Contact us
for their roster data to be erased.

1. A site admin verifies it is them, off-site: in game, or by some other proof.
2. On Admin › Roster Erasures (`/admin/roster-erasures`), the admin gives the Character name and
   @handle. The page first shows which Fleets' rosters name them and how many rows.
3. The admin gives a reason (10 to 500 characters) and confirms. The erasure cannot be undone.

The erasure then does the following, in order:

- **Ledger.** Its marker goes to the ledger first; see [After a restore](#after-a-restore).
- **Rows and aliases.** In one transaction, every roster row and identity alias naming them is
  anonymised: the name becomes "Erased member", the handle becomes a pseudonym of the erasure's
  own (`@erased-…`), and the public comment is emptied. The erasure is recorded in
  `roster_erasure`, and each affected Fleet is asked to replay.
- **Files.** Every stored file naming them is deleted. This covers the files of imports read into
  rows, and any held or still pending import whose file lists them, which is read to find out.
  - An import in force keeps counting.
  - A held import is retired as `SOURCE_ERASED`, and reads "File erased".
  - A file whose bytes cannot be deleted now is marked due, and the nightly retention run deletes
    it.

Head counts, joins and departures stay, so each Fleet's history still adds up. The pseudonym is
distinct for each erasure, so one erased member stays one member in a Fleet's history, and two stay
two.

`roster_erasure` holds an HMAC-SHA256 of the normalised pair, the pseudonym, the reason and who
made it. It never holds the name or the handle, and it is write-once. The hash is keyed with
`rosterErasureKey` from the AWS secret. Without the key, the list reveals nothing, and nothing can
be matched: erasure and preview answer 503. While any erasure exists, a roster upload without the
key is refused rather than stored unscrubbed.

Roster rows stay write-once but for this one rewrite. The observation guard lets the name, the
handle and the comment change only into the erased form.

## Staying erased

The erasures are also the suppression list.

- **Uploads.** Every roster upload is scrubbed against the list before anything is stored,
  including the sanitised file. A row naming somebody erased is rewritten to their pseudonym, with
  no comment. The preview is scrubbed the same way.
- **Replays.** A replay reads only stored rows, and those are already scrubbed, so nothing can
  bring the name back.
- **Byte-identical re-uploads.** A re-upload of the same file returns the earlier, scrubbed import.
  A re-exported old file is scrubbed as it arrives.

## After a restore

A database restored from a backup older than an erasure would bring back what it erased.

Each erasure's marker is also written to a ledger outside the database, before the database. A
marker is one object per erasure, `<NODE_ENV>/erasure-ledger/<createdAt>_<erasureId>.json`, in the
private quarantine bucket, which has no expiry rule. It holds the erasure's ID, the hash, the
pseudonym and when it was made; never the name, the handle or the reason.

**At every boot**, before the API serves anything, the restore check below compares the ledger with
the database. Each marker the database no longer has is made again, oldest first:

- it finds the pair by hashing the stored pairs;
- it anonymises them and deletes their files;
- it records the erasure as replayed, with no admin and the reason "Re-applied from the erasure
  ledger after a database restore."

A marker whose pair the database already holds under another erasure is left alone: the pair is
erased, and the hash is unique. Nobody has to press anything; FC-042 removed the manual
"Replay the erasure ledger" button and its route.

### The restore check (FC-042)

Steve's decisions of 30 September 2026: the backend checks four ledgers kept outside the database
against it at every boot, brings back whatever an older backup lacks, and serves nothing until it
has.

| Ledger | Key, under `<NODE_ENV>/` in the quarantine bucket | Written | Brought back |
| --- | --- | --- | --- |
| Erasures | `erasure-ledger/<createdAt>_<erasureId>.json` | By each erasure, before the database | The erasure, as above |
| Hold events | `hold-ledger/<createdAt>_<actionId>_<PLACED\|EXTENDED\|RELEASED>.json` | By each placing, extension and release of a moderation hold, before the database — see [Fleet chat](fleet-chat.md#the-hold-ledger-fc-042) | The event, under its own ID |
| Asset denies | `asset-deny-ledger/<createdAt>_<assetId>_<REJECTED\|REVOKED\|DELETED>.json` | By each move of a `file_asset` into a denied state, before the database — see [File assets](file-assets.md#the-asset-deny-ledger-fc-042) | The deny |
| Account closures | `account-closure-ledger/<createdAt>_<userId>_<CLOSED\|REOPENED>.json` | By each account closure, before the database — see [Backend](backend.md#the-account-closure-ledger-fc-042) | The closure: the account closed again as of when it was closed |

**When.** `main.ts` runs `RestoreCheckService.run()` after `NestFactory.create()` and before
`app.init()`. `create()` builds the providers — the TypeORM connection, the buckets' S3 clients, the
BullMQ queues — but calls no lifecycle hook. So no HTTP route or WebSocket is bound, no BullMQ worker
has started (`@nestjs/bullmq` starts them in `onModuleInit`) and no scheduled job is registered
(`@nestjs/schedule` mounts them in `onApplicationBootstrap`) until the check has finished. Only the
Cloudflare Images credentials are normally loaded by a hook, `ImageUploadsService.onModuleInit()`;
the check calls `ImageUploadsService.ready()` itself, which fetches them once for both.

**Readiness.** `/health/ready` needs no change: the server does not listen until the check has
finished, so nothing can ask it.

**Cheap.** Each ledger is listed once, and the check compares the IDs in the keys with the
database, read 500 rows at a time. It reads a marker's body only when the database lacks what the
marker is about; an account closure's key holds everything, so none is ever read. The first boot
after FC-042 was deployed also writes a marker for every erasure, hold event, denied asset and
closed account that has none, eight at a time, so the ledgers are complete from then
on.

**One at a time.** The check holds the PostgreSQL advisory lock `1797200000` while it runs. A second
instance starting at the same moment waits for it, then finds nothing left to do.

**Fail closed.** If the bucket or the database cannot be reached, or anything else fails, the check
logs `[run] Restore check failed; the API waits for it - Attempt: n, RetryInMs: t, Reason: …` and
tries again after 1 second, doubling each time up to 60 seconds, for as long as it takes. The API
never starts without the ledgers read, so a deploy's health check fails rather than going live.

**Logged.** Each ledger logs one line of counts, and the check one summary line:
`[reconcile] Restore check finished - Erasures: m/r/b, Holds: m/r/b, Assets: m/r/b, Closures: m/r/b,
ListMs: …, CompareMs: …, ReplayMs: …, BackfillMs: …` (markers, replayed and backfilled). When it brought
anything back, it writes a `LEDGERS_RECONCILED` entry to the site admin log with no actor, such as
"The restore check brought back 2 erasures, 1 hold event, 3 denied uploads and 1 account
closure.", with each ledger's counts in `detail` — see [Admin audit](admin-audit.md#the-site-admin-log).

**Ledger first.** Every ledger is written before the database. A marker whose database write then
failed is brought back at the next boot: an erasure, a deny or a closure is made after all, and a
hold keeps its evidence. Each errs on the side of the ledger.

**Restoring.** The procedure — what to do before, during and after a restore, what this check does
not bring back, and how to check it worked — is the [restore runbook](operations/restore.md).

## An Owner closing their account

When somebody who owns a Fleet Community closes their account, the closure dialog first names each
Community and what will happen to it. It suggests they transfer each one first
(`GET /user/close-account/communities`).

If they close anyway, each open Community is dealt with at closure, and each change is logged:

- **Handed on.** It goes to its longest-serving Admin whose account is open and who owns fewer than
  ten Communities. This is logged as a reassignment by the departing Owner, and the new Owner is
  told.
- **Closed.** A Community that no Admin can take is closed.

A closed Community stays theirs until the account is erased. Then it keeps no Owner: the owner
reference is `ON DELETE SET NULL`, and a CHECK lets only a closed Community have none.

## Erasing a closed account

The nightly closed-account cleanup:

- **Communities.** It hands on or closes any open Community the account still owns, as closing it
  would have. This covers accounts closed before FC-038. If that fails, the account waits for the
  next night.
- **Held accounts.** It keeps back an account whose chat messages a site admin holds, until the
  hold is released. Holds end within their review date plus 14 days.
- **Pictures.** It takes down the account's own pictures from Cloudflare: the profile picture,
  Character portraits and Storytime artwork. The rows that pointed at them go with the account;
  without this, the objects would stay.

## Telemetry

Officer columns never reach any of the places below. They are discarded before anything reads an
upload, as they always have been, and the canary sweeps prove it. The rest of what a person writes
is kept out too.

- **Audit trail.** For chat, roster, news and form content, `_audit` keeps identifiers only: `id`
  and every `…Id`, and nothing a person wrote. The entities marked `@AuditIdentifiersOnly()` are
  `ChatMessageEntity`, `ChatMessageReportEntity`, `ChatReportEvidenceEntity`,
  `ChatTranscriptEntity`, `RosterObservationEntity`, `RosterIdentityAliasEntity`,
  `RosterErasureEntity`, `NewsPostEntity`, `FleetApplicationEntity`, `ContactRequestEntity` and
  `UserReportEntity`. The FC-038 migration scrubbed what was copied before.
- **Sentry (backend).** Neither an error nor a trace carries a request's body, query or cookies,
  nor its credentials.
- **Sentry (frontend).** Session Replay masks every text, input and picture. Errors carry no
  request body, query or cookies. Breadcrumbs record where a request or navigation went, without
  its query.
- **LogRocket.** It masks every text and input on the page. Every request and response loses its
  body and its credentials. It still loads only after analytics consent.
- **Queues and logs.** Queue payloads carry IDs only. The scan worker never logs a filename or
  content.

## Routes

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/admin/roster-erasures` | Site admins: every erasure, newest first, never naming who |
| `POST` | `/admin/roster-erasures/preview` | Site admins: `{ characterName, accountHandle }`, the Fleets naming them |
| `POST` | `/admin/roster-erasures` | Site admins: `{ characterName, accountHandle, reason }` |
| `GET` | `/user/close-account/communities` | The signed-in user: what closing does to each Community they own |
