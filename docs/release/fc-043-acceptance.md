# FC-043 acceptance evidence

Cross-repository privacy, temporal and security acceptance for Fleet Community v1
([FC-043 / #1152](https://app.shortcut.com/startrekonlineinfo/story/1152)): plan section 11's
adversarial matrix, run against the backend, the frontend and the file scan worker. This page is
the evidence FC-045's release checklist points at. Plan section 11's item 9 (LCARS and
accessibility) and the measured load are FC-044's; everything that needs live Render or the live
Cloudflare account is [FC-052 / #1287](https://app.shortcut.com/startrekonlineinfo/story/1287)'s.

## The four criteria

| Criterion                                                                        | Met by                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No officer data leaks or cross-scope access paths.                               | [Parser and privacy](#1-parser-and-privacy), [Authorisation](#5-authorisation); the adversarial rehearsal's A2 (the officer canary in no database, Redis, bucket, log or answer) and A3 (eight routes for eight audiences, forged paths, `no-store`); the route inventory.                                                                                                 |
| All temporal permutations and contribution-reset cases produce expected results. | [Time](#2-time), [History](#3-history); A5 (six orders and a concurrent upload, one result).                                                                                                                                                                                                                                                                               |
| Every upload caller and revoked legacy URL tested.                               | [Scanner and uploads](#6-scanner-and-uploads): the upload matrix drives every caller and fails when a publisher is missing from it; owed purges are now retried. The probe of a revoked legacy URL on the live Cloudflare account is FC-052's.                                                                                                                             |
| No unresolved fail-open scanner or retained-data resurrection defect.            | [Defects found and fixed](#defects-found-and-fixed): two fail-open scanner paths, two resurrection windows and an erasure a missing file could stop, each closed and proved; [Retention, erasure and queue recovery](#10-retention-erasure-and-queue-recovery); A4 and A7. What remains open is listed under [Accepted, and why](#accepted-and-why), none of it fail-open. |

## Steve's decisions

Made on 1 October 2026, before anything was built:

- **clamd limits refuse, as unscannable.** `AlertExceedsMax yes`; a limit reached
  (`Heuristics.Limits.Exceeded.*`) or encryption (`Heuristics.Encrypted.*`) is `UNSUPPORTED`, not
  `INFECTED`; every other detection stays `INFECTED`; `MaxScanTime` below the worker's own timeout.
- **Re-encode every picture at ingress** with sharp: orientation applied, then all metadata
  dropped; PNG lossless, JPEG quality 90; at most 50 megapixels.
- **Owed purges are retried** every hour, and `PURGE_OWED` opens after a day.
- **Retention is caught up at boot**, inside the restore check, before anything serves.
- **Real-stack proof** in a new adversarial rehearsal on throwaway containers.
- **Future dates warn, not refuse,** in the import check.
- **The timezone default is met**: the Settings zone or the device's, confirmed by the check.
- **A route inventory spec** with an allowlist of reasons.
- **Targeted mutation testing**; the break threshold is unchanged.
- **This page**, in the backend, summarised on the story.

## Defects found and fixed

| #   | Defect                                                                                                                                                                                                                                                                                       | Found by                                                                                | Fixed by                                                                                                                                                                                                         | Proved by                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **clamd's limits failed open.** Without `AlertExceedsMax`, clamd stopped at `MaxRecursion`, `MaxFiles`, `MaxScanSize` or `MaxScanTime` and answered `OK` for what it had not read: EICAR one archive deeper than the limit, or after the thousandth member, came back clean.                 | The worker's scan rehearsal, against a real clamd: four `CLEAN` answers before the fix. | Worker `docker/clamd.conf` (`AlertExceedsMax yes`, `MaxScanTime 90000`); `ClamdScanEngineService` reads the limit and encryption heuristics as `UNSUPPORTED`.                                                    | `npm run rehearse:scan` (worker): each is now refused; `clamd-scan-engine.service.spec.ts`.                                                                                                      |
| 2   | **An archive member inflated past `MaxFileSize` is read only so far, and clamd says nothing**, `AlertExceedsMax` or not. A small PNG carrying such an archive — still a PNG to every header check — hid EICAR placed after 70 MiB and came back `OK`.                                        | Probing a real clamd with the fix for 1 in place.                                       | Backend `ImageReencodeService`: every picture is decoded and written out again before it is quarantined, so only pixels are scanned, stored or published. A roster export with a NUL byte is refused at ingress. | `image-reencode.service.spec.ts` (real sharp); the upload matrix's "quarantines only pixels" for every caller; A4. The scan rehearsal records clamd's own behaviour as `NOT reported, by clamd`. |
| 3   | **An owed purge was never retried.** When Cloudflare refused the delete of a withdrawn public or legacy picture, it stayed reachable at its old address for good.                                                                                                                            | Reading the withdrawal path for the "revoked legacy URL" criterion.                     | `OwedPurgeSweepService` (hourly, advisory lock `1797600000`); a 404 counts as gone; `PURGE_OWED`; Scan Diagnostics counts what is owed; migration `1797600000000-AddPurgeOwedAlert`.                             | `owed-purge-sweep.service.spec.ts`, `asset-withdrawal.service.spec.ts`, `operations-alert.service.spec.ts`; A7 (the alert opens; the migration's down refuses, then reverts, on PostgreSQL 18).  |
| 4   | **Retention-purged data came back after a restore** — chat messages past 45 days, roster files past 180 days, transcripts — readable for up to a day until the next run.                                                                                                                     | `docs/operations/restore.md` said so.                                                   | The restore check calls `FleetRetentionScheduler.catchUp()` after the ledgers, holds first, before the API serves.                                                                                               | `restore-check.service.spec.ts`, `fleet-retention.scheduler.spec.ts`; A7 (a 50-day-old message and an expired roster file gone before a restarted backend serves).                               |
| 5   | **A roster export read through the wrong zone looked normal.** A future export stamp or row date, the usual sign, passed without comment.                                                                                                                                                    | Plan section 11.2's "future clock warnings".                                            | `RosterImportPreviewService` reports `futureDates`; the frontend warns and asks "The timezone is right; import it anyway" first; Help says so.                                                                   | `roster-import-preview.service.spec.ts` (ten-minute tolerance, the repeated hour); `roster-import.component.spec.ts`.                                                                            |
| 6   | **An erasure could be stopped by a file that had gone.** Erasure reads every held or pending roster file for the person, and a missing object failed the whole request with a 500 — the person could not be erased; it also read files the scanner had refused, which can never be imported. | The adversarial rehearsal: an erasure after a refused upload's bytes were dropped.      | `RosterErasureService` reads only files that can still be imported, and a missing object names nobody (logged); a bucket that cannot answer still stops it. `isMissingObject` is shared with publication.        | `roster-erasure.service.spec.ts`; A7.                                                                                                                                                            |

## The matrix, item by item

What existed before FC-043 is listed with what FC-043 added (**new**). Paths are this repository's
unless marked (FE) for the frontend or (W) for the worker.

### 1. Parser and privacy

- Normal and officer headers, omitted officer tails, quotes and commas, malformed and ambiguous
  tails, BOM, UTF-8, line endings, size, row, line and field limits, NUL and DEL:
  `roster-csv-privacy-parser.service.spec.ts` and its fuzz spec; the committed fixtures and
  `roster-dialect-contract.spec.ts`.
- **New:** a header with semicolons, tabs, a repeated or reordered column, or quoted, is refused at
  line one; a comma smuggled into a name is refused rather than shifting the columns; any rank
  label (117 in the corpus, a formula included) is kept exactly as text.
- Duplicate identities, unknown Class: `roster-typed-parser.service.spec.ts`.
- The officer canary: `officer-canary-sinks.spec.ts`, `officer-canary-containment.spec.ts`.
  **New: A2** proves it end to end — a run-made token in the officer columns is nowhere in a whole
  `pg_dumpall`, Redis (saved uncompressed), any object in any bucket, either application's log, or
  any answer, each search with a control it must find.
- Spreadsheet-safe export: `csv.utility.spec.ts`. **New:** every report kind carrying free text is
  rendered with formulas in it, and no cell starts one (`fleet-report-csv.service.spec.ts`).

### 2. Time

- Paired UK/US fixtures, the 4- and 5-hour offsets, leap and invalid dates, midnight and noon, the
  gap and the fold, unknown and abbreviated zones, correction replay: `timezone.utility.spec.ts`,
  `roster-typed-parser.service.spec.ts`, `roster-export-identity.service.spec.ts`,
  `roster-import-correction.service.spec.ts`, `test/fleet-community-fixtures.spec.ts`.
- **New:** future-date warnings (defect 5).
- **New:** the timezone is never inferred by the server: `roster-import-timezone.dto.spec.ts`
  refuses a check or an import with no zone, an abbreviation, an offset or a made-up name. The
  form starts on the Settings zone or the device's, and the check shows every date read through it
  before anything imports (FE `roster-import.component.spec.ts`: a check read through one zone is
  thrown away when the zone changes).

### 3. History

- All six permutations, add, exclude and reinstate a middle export, timestamp conflicts, duplicate
  retries, join, leave and rejoin, renames, ambiguous matches, contribution resets and interval
  coverage: `roster-projector.spec.ts` and its fuzz spec, the import, conflict and identity specs.
- **New:** a mass rank relabel is rank changes and nothing else (`roster-projector.spec.ts`).
- **New: A5** repeats the permutations through the real stack: three exports in all six orders,
  one Fleet each, and all three at once to a seventh, give identical rosters and histories.
- Replay crash and restart: `roster-replay.service.spec.ts`, `roster-replay-sweep.service.spec.ts`;
  the operations rehearsal's S2.

### 4. Domain

- Same-name Fleets, standalone Fleets, one current membership, Armada capacity and platform,
  departure: `sto-fleet.service.spec.ts`, `character-fleet-membership.service.spec.ts`,
  `armada-arrangement.utility.spec.ts`, `recruitment-membership.service.spec.ts`; the migration
  rehearsal's assertions. A `LEFT` membership confers nothing (`role-audience-matrix.spec.ts`).
- **New:** no Armada cycle can be built — a Gamma under itself, two under each other, or under a
  Fleet outside the Armada (`armada-arrangement.utility.spec.ts`).

### 5. Authorisation

- The policy: `role-audience-matrix.spec.ts` (deny beats grant, followers and applicants get
  nothing, roster rank names confer nothing, own, sibling and other scopes, forged nested IDs),
  `following-and-access-matrix.spec.ts`, `site-admin-investigation.spec.ts`,
  `scope-capability.guard.spec.ts`, report access and suppression specs.
- **New: `test/route-inventory.spec.ts`.** Every route Nest would serve — 547 today — is held to a
  requirement a guard checks, or a place on the signed-in or public list with a reason. A route
  added without one fails. It also refuses a guard with nothing declared, a scope parameter missing
  from its path, a nested Fleet or Armada not tied to the Community in its path, and roster rows
  (comments, handles, Last Active) served anywhere but `RosterController` behind the roster
  capabilities.
- **New: A3** over HTTP: the roster, its history, the imports, a report's CSV, the Fleet's chat
  channel, giving a role, Scan Diagnostics and the erasure list, for anonymous, a stranger, a
  follower, a member, an Officer, a Community Admin, the Owner and another Community's Owner — each
  as the policy says, no refused answer carrying a name, handle or comment, giving a role refused by
  a guard before validation; a Fleet named under another Community's path refused even to that
  Community's Owner and the site admin; `Cache-Control: no-store` on every answer.

### 6. Scanner and uploads

- Clean and EICAR, timeouts and odd replies, oversize, type spoofing, stale signatures, hash races,
  stale completion, lost leases, duplicate jobs, outages, campaign overlaps: the worker's engine,
  scan, attempt and processor specs, the contract specs on both sides, `rehearse:scan` (W).
- **New:** defects 1 and 2. **New in `rehearse:scan` (W):** archives nested past the limits,
  encrypted archives, and a signature reload while a scan is streaming.
- Every upload caller: `test/asset-upload-matrix.spec.ts`. **New:** it now runs real pictures
  through the real re-encoder, covers scoped news covers (seventeen callers), checks every caller
  quarantines only pixels, and fails when any publisher in `src` is neither driven by it nor named
  with where its evidence is (the roster import, a restricted file with its own ingress).
- Revoked URLs: defect 3. The live probe is FC-052's.
- **New: A4** through the real pipeline: bytes swapped in the bucket after an upload are refused
  `HASH_MISMATCH`; the registry refuses to rewrite a recorded hash, even in SQL
  (`file_asset.sha256 is write-once`); a file carrying a signature the real clamd knows, planted
  where a roster was with a hash and a fresh request that agree, is refused `INFECTED`; an archive
  declared as a roster is refused `CONTENT_TYPE_MISMATCH` before any scan. **A8**: a file that is
  not a picture is refused at the door; a polyglot picture is stored as pixels only. The detection
  is a signature the rehearsal gives its own clamd, not EICAR: the antivirus on the machine that
  ran it intercepts EICAR in localhost HTTP between MinIO and the worker, and the worker then
  answers `RETRY`, never clean. EICAR itself is detected by the real clamd in `rehearse:scan` (W).

### 7. Events and content

- Scoped news never in global feeds, recurrence across clock changes, cancellation, waitlists,
  reminders: `news.service.spec.ts`, `scope-news.service.spec.ts`, the event specs. Markdown links:
  FE `markdown.pipe.spec.ts`.
- **New: A6**: four members answer Going to one place at the same moment; one gets it, three wait
  at 1, 2 and 3.
- **New:** the event's own link opens with `noopener noreferrer` (FE
  `fleet-event-detail.component.spec.ts`).

### 8. Chat and social

- Friend-only direct messages, blocks and revocation mid-session, duplicate sends, reconnects,
  token expiry, cursors and old replies, transcripts, the purge and holds, presence and typing: the
  chat specs and `rehearse:chat-socket` (two instances, real sockets).
- **New:** a payload naming another author, sender or time is not believed
  (`chat.gateway.spec.ts`); exactly four hours, seven days and forty-five days, with the clock
  stopped (`chat-message.service.spec.ts`, `chat-transcript.service.spec.ts`).

### 10. Retention, erasure and queue recovery

- Erasure, closure, holds and the ledgers: the erasure, closure, hold and restore specs; the
  operations rehearsal's S4.
- **New:** defect 4, and **A7**: a member erased leaves no trace in any database or bucket; an
  export naming them imported again, and the replay it causes, bring nothing back; neither
  application ever logged their name or handle.
- Queue recovery: the failed-jobs, re-queue and stranded-verdict specs; the operations
  rehearsal's S2, S3, S6 and S8.

## Mutation testing

Stryker, on the files that carry privacy, time and authorisation, with the project's
configuration; the break threshold stays at 0.

A full run over the seven files on 1 October 2026 made 1,609 mutants. 521 did not compile, which
leaves 1,088 to score: **87.96%**, with 131 surviving. Each survivor was read. Tests were added
for the real gaps, and every survivor that could be re-run was re-run: Stryker on the survivors'
lines, and by hand for seven that span several lines.

| File                                   | First run  | Now        | Surviving |
| -------------------------------------- | ---------- | ---------- | --------- |
| `fleet-authorisation.service.ts`       | 75.00%     | 87.70%     | 30        |
| `fleet-audience.service.ts`            | 81.61%     | 89.66%     | 9         |
| `scope-capability.guard.ts`            | 88.46%     | 100.00%    | 0         |
| `roster-csv-privacy-parser.service.ts` | 91.95%     | 94.30%     | 17        |
| `roster-typed-parser.service.ts`       | 95.42%     | 99.24%     | 1         |
| `roster-projector.ts`                  | 96.94%     | 98.69%     | 3         |
| `timezone.utility.ts`                  | 80.82%     | 90.41%     | 7         |
| **All seven**                          | **87.96%** | **93.84%** | **67**    |

**What the new tests pin down:**

- **Roles:**
  - An Armada Officer is an Officer of that Armada alone: not of a sibling Armada, the Community or a placed Fleet.
  - A Fleet Officer gets nothing at the Community.
- **Armada membership:** a pending, rejected or left membership of a placed Fleet makes nobody an Armada member.
- **The per-request cache:** it keeps two users apart, and two claimed Communities apart.
- **Site admins:** one looking into a Fleet may open its Community and none of its Armadas.
- **Community membership:** somebody granted a capability, with no role or membership, counts as part of the Community.
- **Refusals:**
  - They carry no detail, and an anonymous denial is logged as anonymous.
  - The guard reads the declaration from the handler, then from the controller.
- **Exact edges:** the upload size, line length and field length; an invitation lapsing at this instant; the last second of a minute.
- **Malformed against non-existent times:** a calendar field out of range is malformed, not a time that does not exist.
- **Rejected values:**
  - A meridiem other than am or pm.
  - A control character in the header.
  - An upload that is only a byte order mark.
  - A missing opening quote or delimiter in the sanitised file.
  - A handle run into the name after it.
- **The projector:**
  - It orders exports by when they were taken, not by their identifiers.
  - A Join Date at the instant of the last export is the same stay.
  - An opening that knew no name or rank reports no rename or rank change.

The in-memory world the authorisation specs run in (`test/fleet-authorisation-world.ts`) now
behaves like the real stack in two ways:

- it returns only the columns a query selects;
- like nestjs-cls, it refuses to write outside a request.

So a service that reads a column it never selected, or caches without a request, fails there as
it would in production.

**The 67 still surviving change nothing anyone can observe:**

- **Column selections (17):**
  - `select: {}`, which TypeORM reads as every column;
  - or a column that only callers outside these services read.
- **Caches and early exits (22):**
  - the per-request and per-process caches, and their keys' fallbacks for an empty string;
  - returns that stop a search once its answer is known: a second reading that already makes a
    row ambiguous, or the Armada lookup at any other kind of scope.
- **A condition another check already decides (20):**
  - membership against capability;
  - an investigation away from a Fleet;
  - a DENY grant added before it is removed;
  - the narrower of two equal statuses;
  - two candidates that are already in order;
  - `Number('')` against `Number('0')`;
  - reading one past the end of a line or a date;
  - an empty `default` branch.
- **The parser's search accounting (8):**
  - a charge to the step budget that the other charges already bound;
  - the budget's exact boundary;
  - start positions that can never close a field.

The break threshold stays at 0, as decided.

## The adversarial rehearsal

`npm run rehearse:adversarial`; the scenarios are in its
[README](../../scripts/adversarial-rehearsal/README.md).

A run on 1 October 2026 (Windows, Node 24, `postgres:18-alpine`, `redis:7-alpine`, MinIO, clamd
on `clamav/clamav:stable` with the worker's configuration, LocalStack): **50 passed, 0 failed**.

| Scenario                      | What held                                                                                                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 Cold start                 | Stack ready in 42 s; the restore check, retention catch-up included (125 ms), ran before the API listened.                                                                                                                                                                          |
| A1 People and places          | Eight audiences and a second Community made.                                                                                                                                                                                                                                        |
| A2 Officer canary             | The token in 0 places: a 1.47-million-character `pg_dumpall`, Redis, every bucket object, 2.4 million characters of logs, every answer; each search found its control. The public comment beside it reached the roster.                                                             |
| A3 Who may call what          | 8 routes × 8 audiences as the policy says; no refused answer or outsider's report carried a name, handle or comment; five forged or made-up paths all 404; `no-store` on all 90 answers.                                                                                            |
| A4 What the scanner is handed | `HASH_MISMATCH`, the write-once refusal, `INFECTED` and `CONTENT_TYPE_MISMATCH`; nothing published unscanned.                                                                                                                                                                       |
| A5 Order never matters        | 21 exports into 7 Fleets in 11.8 s; all six orders and the concurrent upload gave one roster and history.                                                                                                                                                                           |
| A6 Racing for the last place  | Four simultaneous answers: one place, waitlist 1, 2, 3.                                                                                                                                                                                                                             |
| A7 Nothing comes back         | 72 database and 32 bucket sightings before the erasure, 0 after it and 0 after the re-import; 0 log lines; a 50-day message and an expired roster file gone before the restarted backend served (10.4 s); `PURGE_OWED` opened in 45 s; its migration's down refused, then reverted. |
| A8 Pictures at the door       | Not a picture: 400. A polyglot: stored as 95 bytes of pixels.                                                                                                                                                                                                                       |
| All                           | Nothing tried to reach Cloudflare; ten SendGrid calls (notification emails) were refused by the egress guard.                                                                                                                                                                       |

The worker's `npm run rehearse:scan` on the same day: **39 passed**, among them the archive limits
(refused `UNSUPPORTED`), the encrypted archive, clamd's unreported per-file limit (recorded as
such), and a signature reload while a scan was streaming.

## Accepted, and why

None of these is fail-open:

- **Legacy pictures (`UNVERIFIED`) are served without having been scanned**, by design since
  FC-040; rescan campaigns are how they are scanned.
- **A rescan that gets no verdict within a day gives up and the picture stays served**: it had
  already been cleared once, and a rescan only re-asks.
- **Static pages' third-party links** (Credits) open in a new tab without `noreferrer`; they are
  fixed text, outside Fleet Community.
- **Live checks** — the deployed scanner, Cloudflare's real behaviour for a revoked URL — are
  FC-052's.
