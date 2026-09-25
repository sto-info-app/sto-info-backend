# Roster history: episodes, changes and intervals

How a Fleet's roster exports become a history of who was in it, what changed and how much was
contributed — and what that history will never claim.

FC-019. See also [Roster imports](roster-imports.md) for how an export becomes observations and
[Roster identities](roster-identities.md) for how two names are found to be one person.

## The one-sentence version

Every change to a Fleet's evidence replays the Fleet's whole effective history, identities first,
into a new numbered revision that is published at once; nothing is dated more exactly than the two
exports it lies between, and nothing missing from an export is taken to have left unless the export
could have shown it.

## What the exports can and cannot say

Plan section 3.6, with Steve's decisions of 25 September 2026:

- **Presence is evidence; absence only from a complete export.** A member missing from an export
  marked partial, or whose row an investigator excluded, is *unknown* there. An unknown never ends
  a membership.
- **A departure is bounded, not dated.** It lies between the last export that listed them and the
  first complete one that did not — never "on" the later export's date.
- **A Join Date after the previous export means they left and came back** in between. The episode
  ends, a new one begins, and its contribution starts from a new baseline. Any other change of Join
  Date is recorded and keeps the episode. An ambiguous Join Date, from the morning a clock went
  back, is never a time claim, so never a rejoin.
- **A contribution delta is the later total minus the earlier, within one episode, when it is not
  negative.** A fall is a *reset*: a discontinuity with no delta, never a negative donation.
  Nothing is carried across a rejoin, and a leaver's final total is unknown.
- **Nothing is allocated between exports.** A change across an export where the member was unknown
  is recorded once, bounded by the two exports it lies between, and counted in no interval.
- **Several rows for one identity in one export** — two names a confirmed rename joined, both still
  listed — show presence and no values.

The corpus cases this was built against are in the projector's spec: House of MidNite's 1,061,699
to 0 with a new Join Date (a rejoin, not a withdrawal) and -DME-'s +70,700 with a Cadet to Ensign
label change.

## What is stored

Everything here is derived and rebuildable. Observations stay the source of truth, and dropping
these tables and replaying every Fleet gives them back.

| Table | What it holds |
| --- | --- |
| `fleet_roster_projection` | One row per Fleet: the published revision, when, its latest effective export, and the `requested` and `built` counters |
| `fleet_roster_projection_input` | Every import a revision considered, and whether it was read — `EFFECTIVE`, `EXCLUDED`, `NOT_SELECTED`, `AWAITING_SELECTION` or `SAME_AS_EFFECTIVE` |
| `fleet_roster_episode` | One stretch of one identity's membership: how it began (`FIRST_SEEN`, `JOINED`, `REJOINED`), how it ended (`LEFT`, `LEFT_AND_REJOINED`) and the exports bounding each, the reported Join Date, and the first and last contribution known in it |
| `fleet_roster_change` | One change to one member between two exports: joined, rejoined, left, renamed, rank changed, Join Date changed, contribution rose (with its delta) or reset |
| `fleet_roster_interval_summary` | One row per pair of consecutive effective exports: members at each end, the changes within it, and the contribution delta with its known, reset, baseline and unknown counts |

Every derived row carries its revision. The keys hold each row to its Fleet and revision: an
episode refers to its identity through `(id, fleetId)`, and a change to its episode through Fleet,
revision, identity and ordinal. A contribution delta is allowed only on a rise, and only above
zero.

An interval's four contribution counts account for every member listed at either end exactly once.
`acrossGap` counts what became known at the later export but is bounded more widely — each with its
own change row — and members first seen there whom no earlier export bounds. None of those is in
the interval's other totals.

Rank labels are the Fleet's own text, and a change is only ever `RANK_CHANGED`. Nothing here calls
one a promotion.

## The replay

A Fleet's roster is replayed whenever an import goes into force, a reviewer decides a rename, or an
investigator corrects an import. One job does all of it, on the `fleet-roster-replay` queue:

1. It takes the Fleet's advisory lock — the one a reviewer's decision takes, so the two never
   interleave.
2. It reads `requested`. If `built` has already reached it, a replay since the request covered it,
   and it builds nothing.
3. It decides which import of each moment is effective and reads those.
4. It recomputes identities from them.
5. It projects episodes, changes and intervals from the identities that leaves.
6. It writes the next revision's rows beside the published one's, moves the projection to it with
   `built` set to the value read in step 2, and deletes any revision older than the one before.
7. It sets the Fleet's `lastEffectiveImportAt` to the revision's latest effective export — back as
   well as forward.

All of that is one transaction. A crash rolls it back, and the retried job starts from the same
evidence. A report reads the revision number first and pins every query to it, and the revision
before stays until the next publish, so a report never mixes two.

The whole Fleet is held in memory while it is projected. Plan section 3.6 accepts a full replay in
v1; the corpus's largest Fleets run to a few hundred exports.

### Which import of a moment is read

- An excluded import never is.
- In a conflict group with a selection, the selected export is read if it is in force and not
  excluded, and a copy of it is `SAME_AS_EFFECTIVE`. The rest were `NOT_SELECTED`. A selection whose
  export is excluded afterwards leaves the moment with none until somebody selects again.
- Otherwise the first version of the moment stands, as FC-017 keeps it in force, and anything held
  is `AWAITING_SELECTION`.

### Asking for a replay

A change calls `RosterReplayQueueService.request` inside its own transaction, which bumps the
Fleet's `requested` counter, and `enqueue` after it commits. So a change can never be made without
the projection knowing it is behind, and the job never runs before the change is visible.

Jobs are not keyed by Fleet — a keyed job is dropped while one is running — and the counters make a
surplus one cost two reads. `requested` ahead of `built` is what a stale projection is: the
published revision is still served, and labelled so.

If queueing fails after a commit, the request is still recorded. `RosterReplaySweepService` queues
every Fleet whose projection is behind, every ten minutes.

### Proposals

Character Fleet proposals are raised after the transaction, and only when the revision's latest
effective export differs from the one they were last raised from, which `proposedImportId` records
once they have been. A replay that changed history but not the latest export asks nobody anything
again, and one that crashed between publishing and proposing is finished by the next replay of the
Fleet, even one with nothing to build. The rules for who is asked are FC-018's, in
[Roster identities](roster-identities.md#association-proposals).

## Corrections

An investigator — a `roster.investigate` holder, never an importer as such — can change how an
import counts without changing anything it said. Every correction requires a reason and is kept,
with who made it and when, in `fleet_roster_import_action`, which is append-only. Each one locks the
import, records its request for a replay in the same transaction, and queues it after committing.

| Correction | What the replay makes of it |
| --- | --- |
| **Exclude** an import, or **reinstate** it | It stays evidence and leaves every derived result. Reinstating rebuilds exactly what was there before |
| Mark an export **partial**, or complete again | Its rows still show who was there, but nobody missing from it is taken to have left |
| **Correct the timezone** an export was read in | Its stamp and every row date are read again from the local text, so it takes its true place in the Fleet's history |
| **Select** the export that stands for a disputed moment | It is read for the moment and the group's other exports are not. A held export is read into force first |
| **Exclude rows**, or put them back | Each member an excluded row names is unknown in that export — neither present nor absent |

Only an import in force, or held for a conflicting export, can be corrected: one still scanning,
refused or given up on has never counted. Only one in force has rows to exclude.

An export marked partial, or with any row excluded, is also skipped when renames are paired — see
[Roster identities](roster-identities.md#the-recompute) — so a rename resting on it is flagged stale
until the export is complete again.

### Correcting a timezone

The local text of the export's stamp and of every date in its rows is kept for exactly this (plan
section 3.4). A correction reads all of it again through the new zone, or none of it: a stamp or
date that never happened there refuses it, as an upload would have been refused. A stamp naming two
moments in the new zone needs one of them chosen, as at upload. The moment it moves to must be free
— the lock an upload claiming that moment takes is taken first — and an import in a conflict group
cannot be corrected until the group is settled another way (Steve's decision of 25 September 2026).
The Fleet-name match made at upload is not redone: a former name's validity runs to months, and a
correction moves the stamp by hours.

### Selecting between exports of one moment

FC-017 groups exports of a Fleet that claim the same instant and say different things, keeps the
first version in force and holds the rest. Selecting settles the group: the selected export is read
for the moment, and a copy of it is `SAME_AS_EFFECTIVE`. A held export has never been read, so
selecting one queues it for publication; the publisher is asked again, finds it selected and reads
it into force, and its going into force queues the replay.

There is one group per Fleet and instant, ever (Steve's decision of 25 September 2026). An export
arriving for a settled moment joins its group; if it says something different from the selection,
the group is reopened and the newcomer held, while the selection stays in force. Selecting again
settles it. An import that is merely held asks for no replay, so it appears among a revision's
inputs from the next one.

An import's detail shows an investigator its excluded lines, its corrections newest first with the
investigator's STO Info username, and its conflict group's selection. Everybody who can read it sees
whether it is excluded or partial.

## Where the history stands

`GET …/fleets/:fleetId/roster-projection` — for whoever imports or investigates a Fleet's rosters —
reports the published revision, whether it is stale, and every import it considered with what it
made of each. It reads the revision number first and then only that revision's inputs. See
[the API](api-endpoints.md#get-fleet-communitiescommunityidfleetsfleetidroster-projection). The
roster, history and reports themselves are FC-020's.

## After deploying

Run once, so Fleets imported earlier get a first revision:

```bash
npm run fleet:replay-rosters -- --dry-run
npm run fleet:replay-rosters
```

## How it is proved

| Check | What it covers |
| --- | --- |
| `roster-projector.spec.ts` | Every rule above, the corpus cases, all six orders of three exports, and a middle export added and excluded |
| `roster-projector.fuzz.spec.ts` | Over generated histories: order invariance, no negative delta, the per-interval partition, departures only at complete exports, ordered and disjoint episodes |
| `roster-input-classifier.spec.ts` | Which import of a moment is read, with and without a selection |
| `roster-replay.service.spec.ts` | Skipping a covered request, the revision written beside and published, the revision before kept, the Fleet's date following it, and proposals raised once |
| `roster-import-correction.service.spec.ts` | Each correction's refusals, the lock, the record, and the request committed with the change; the timezone re-read and the selection's release of a held export |
| `roster-import-conflict.service.spec.ts` | One group per moment, reopened when a newcomer disagrees with its selection; holding judged against the selection |
| `roster-projection-status.service.spec.ts` | The status pinned to one revision, and stale when a change is waiting |
| `roster-projection-schema-alignment.spec.ts` | The five entities against their migration |
