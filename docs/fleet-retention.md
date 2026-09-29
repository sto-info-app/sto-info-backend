# Fleet retention jobs

How the Fleet Community forgets what it no longer needs (FC-037, R22, R27 and R28). The schedule
is in `src/fleet/retention`. Each job's code lives with what it deletes. The decisions below are
Steve's, from 29 September 2026.

- [The jobs](#the-jobs)
- [How each run works](#how-each-run-works)
- [Roster files](#roster-files)
- [Soft deletes](#soft-deletes)
- [Holds past review](#holds-past-review)
- [Closed accounts](#closed-accounts)
- [What is kept](#what-is-kept)

## The jobs

All times are UTC, set by `FleetRetentionScheduler`.

| Job | When | What goes |
| --- | --- | --- |
| `ROSTER_SOURCES` | 04:11 daily | Sanitised roster files whose `retainUntil` has passed: 180 days after upload, or `IMPORT_SOURCE_RETENTION_DAYS` |
| `NEWS_POSTS` | 04:05 daily | Scoped news posts deleted more than 30 days ago. The site's own news is never touched |
| `CHARACTER_FLEET_MEMBERSHIPS` | 04:07 daily | Character Fleet memberships retracted more than 30 days ago |
| `CHAT_MESSAGES` | 04:23 daily | Chat messages older than 45 days, or `CHAT_RETENTION_DAYS`, except those of a held member |
| `CHAT_REPORTS` | 04:41 daily | Chat reports closed more than 90 days ago, with their evidence, except held ones |
| `CHAT_TRANSCRIPTS` | hourly | Transcript files past their 24 hours; transcripts never written are marked failed |
| `ACTIVITY` | 03:41 daily | Activity items older than twelve months |
| `MODERATION_HOLDS` | 05:03 daily | Holds past their review date: notices, then release. See [Holds past review](#holds-past-review) |
| `RETENTION_RUNS` | 05:11 daily | This record's own runs, after a year |

The 45-day chat purge is its own clock. What a member may read (four hours) and what a transcript
may take (seven days) are windows on what is still stored. Neither changes when the purge runs, and
the startup check refuses a `CHAT_RETENTION_DAYS` below seven.

**None of the jobs asks whether the Fleet feature is on.** Retention is owed whether or not anybody
can see the feature. `FleetFeatureService` says jobs like these must never inject it, and a spec
holds the scheduler to that.

## How each run works

- **Bounded.** A job deletes at most 40 batches of 500 rows a run. Each batch is its own statement.
  A job that reads rows one at a time, such as roster files and transcripts, takes at most 500 a run.
- **Resumable.** A run changes whole batches, or one whole file, at a time. When a run stops at its
  limit or fails, what is left is still due, and the next run finds it and carries on. A file whose
  bytes cannot be deleted is left as it was, and the next run tries again.
- **Recorded.** Every run writes a row to `retention_run`. The row gives the job, when it started
  and finished, what it did (for example `{"messages": 1200, "heldAuthors": 1}`), whether it got
  through everything due, and why it stopped if it failed.
  - A failure is caught and recorded, never thrown. An unhandled rejection inside a scheduled job
    would take the process down.
  - A finished row is write-once, enforced by trigger.
  - Runs are kept a year.
  - No page shows them yet. FC-039's diagnostics may.

## Roster files

A file goes when its `retainUntil` passes, whatever its import's state. The bytes are removed from
the quarantine bucket first. The asset is then marked `DELETED` with storage `NONE`, in one
transaction with anything its import needs.

- **The Fleet's history stays.** An import in force was read into observations when it went into
  force, and nothing reads its file again. Corrections, replays, identities, reports and rank order
  all read the stored rows. Its placement is left alone, so it counts exactly as before, and it
  still reads `IMPORTED`.
- **A held import is retired.** An import waiting in a conflict has never been read, and selecting
  it would read its file. When the file goes:
  - its placement is withdrawn;
  - its log records `SOURCE_EXPIRED`, made by STO Info;
  - the Fleet is replayed, so the import leaves the projection's inputs.

  It then reads `EXPIRED`. The conflict page lists it with that status and a note, and offers no
  Select. Selecting or correcting it is refused with "This export's file has expired". The group
  itself is not changed, so an investigator still settles it by selecting the export that stands.

## Soft deletes

Scoped news posts and retracted Character Fleet memberships are deleted for good 30 days after
their soft delete (`SOFT_DELETE_RETENTION_DAYS`). That is long enough to undo a mistake or look into
one.

A post's cover was withdrawn when the post was deleted. Its registry entry outlives the post, as
every withdrawn asset's does.

Closed Communities, Fleets and Armadas are kept for ever. Closure is a status, and nothing purges
it.

## Holds past review

No hold runs on without review. For each hold in force whose review date has passed:

1. **On the day**, its owner is told in-app, once per review date. The owner must still be an open
   site admin account; otherwise every open site admin is told.
2. **Seven days before release**, every open site admin is told, once.
3. **Fourteen days after the date**, if nobody has extended it, STO Info releases it. The release
   reason reads "Released automatically: not reviewed within 14 days of its review date".

Each step is logged in `moderation_hold_action`: `REVIEW_DUE` and `RELEASE_WARNED` for the
notices, and `RELEASED` with no actor and `automatic` for the release.

- Extending a hold moves its review date, and all three steps start again from the new one.
- A release checks the hold again under a lock, so one extended or released in the meantime is left
  alone.
- The hold's `releasesAt` says when the system would release it.
- Notices never name the person, since anyone at the admin's screen may read them.

## Closed accounts

The nightly closed-account cleanup keeps back an account whose chat messages a site admin holds.
Deleting it would leave its messages with no author, and the next chat purge would take them
despite the hold. It is erased once the hold is released.

Before FC-038, an account that still owned a Fleet Community was kept back as well, because the
owner reference was `ON DELETE RESTRICT`. FC-038 hands such a Community on, or closes it, first.
See [Privacy: erasure](privacy-erasure.md#erasing-a-closed-account).

## What is kept

| Table | Kept |
| --- | --- |
| `retention_run` | A year |
| `file_asset` for a roster file | The row stays, `DELETED`, as the record that the file existed. The import that points at it stays too |
| `fleet_roster_import_action` | Kept with its import, including `SOURCE_EXPIRED`. The system's `SOURCE_EXPIRED` and `SOURCE_ERASED` are keyed by the import, so a retried run writes each once (FC-039) |
| `moderation_hold`, `moderation_hold_action` | Kept, including the system's notices and releases. Each notice is keyed by the hold and its review date, and a release by the hold, so two runs that cross write each once (FC-039) |
| `site_admin_action` | Under the audit policy, like `_audit`; see [Admin audit](admin-audit.md#write-once-and-how-long-it-is-kept) |
