# Roster identities: renames and association proposals

How the site works out that two names in a Fleet's roster are one person, what it will and will
not conclude on its own, and how a roster row reaches a registered Character's owner as a
question.

FC-018. See also [Roster imports](roster-imports.md) for how an export becomes observations, and
ADR-0002 in the Fleet Community plans for the separation of evidence, personal association and
access that everything here rests on.

## The one-sentence version

The site suggests renames from consecutive exports and asks people about them; it never merges two
names, links a roster row to an account, or changes an STO Info account handle without a person
deciding to.

## What a roster row can tell you

A row names a Character and an account handle, and the game lets both change without saying so.
There is no stable identifier in an export, so a Character renamed between two exports looks
exactly like one member leaving and another joining. The corpus holds 106 one-to-one Character
rename candidates and a single account rename candidate, and neither kind proves anything on its
own.

## The four tables

| Table | What it holds |
| --- | --- |
| `fleet_roster_identity` | A UUID for somebody a Fleet's roster listed. No STO Info account needed: a member who has never signed up is as much a roster entry as one who has |
| `fleet_roster_identity_alias` | One exact normalised Character name and handle in one Fleet, which identity it belongs to now, and the identity it was born with |
| `fleet_roster_identity_candidate` | A rename the evidence suggests, its corroborating checks, its confidence, why it cannot be resolved if it cannot, and where a reviewer has left it |
| `fleet_roster_identity_candidate_link` | Each pair of aliases a candidate would join — one for a Character rename, one per Character for an account rename |
| `fleet_roster_identity_decision` | Each confirm, reject or undo, numbered per candidate and write-once |

Observations are never written to. An observation joins to its alias on the Fleet, normalised
name and normalised handle, so a decision rewrites a small alias table rather than every row of
every export. The plan put an identity column on the observation; this was decided against on
24 September 2026.

## What makes a candidate

Only two **consecutive in-force exports** are compared, and only a row gone from the later against
a row new in it. Then, as hard gates:

- **A Character rename** keeps the account handle and changes the name.
- **An account rename** keeps the name and changes the handle. A candidate names the pair of
  handles and cites every Character that moved between them.
- Either way the join instant is present, was not one of two on a clock-change morning, and is
  equal, and the Class text is identical.

Nothing is ever matched on a join date or a name alone.

Three checks are graded into the confidence rather than required, because the corpus holds a
probable rename whose contribution changed:

| Signal | Holds when |
| --- | --- |
| `LEVEL_NOT_LOWER` | The later row's level is not below the earlier's |
| `CONTRIBUTION_NOT_LOWER` | The later cumulative total is not below the earlier's, compared as bigints |
| `RANK_CHANGE_NOT_EARLIER` | The later rank change is not dated before the earlier; unknown where either is missing or ambiguous |

None failed is `HIGH`, one is `MEDIUM`, two or more `LOW`. An account rename resting on a single
Character is never above `MEDIUM`.

## What makes one unresolvable

A candidate with any of these is recorded and shown, and can be neither confirmed nor rejected —
the database refuses to let it leave `OPEN`:

| Reason | Meaning |
| --- | --- |
| `SEVERAL_PARTNERS` | One of its rows could pair with more than one row on the other side, by either kind of rename. The multi-alt case |
| `OLD_HANDLE_STILL_PRESENT` | The old handle is still in the later export. A handle belongs to the whole account |
| `NEW_HANDLE_ALREADY_PRESENT` | The new handle was already in the earlier export |
| `HANDLE_SPLIT` | One handle's Characters moved to more than one new handle |
| `HANDLE_MERGE` | Two handles' Characters moved to the same new one |
| `LISTED_TOGETHER` | A partial export between the two listed both names at once |

## The recompute

A Fleet's identities are worked out again from scratch — every effective import, in export order —
whenever an import goes into force, a reviewer decides something, or an investigator corrects an
import. Since FC-019 this is the first step of the Fleet's roster replay (see
[roster-history.md](roster-history.md)), which runs on the `fleet-roster-replay` queue, one Fleet
at a time under the same advisory lock a decision takes. The recompute:

1. upserts aliases by their exact key, so an alias keeps its UUID and identity;
2. inserts new candidates, rewrites open ones from the evidence, removes undecided ones the
   evidence no longer suggests, and **never changes a decided one** — it flags it `stale` when its
   evidence moves, so a reviewer knows to look again;
3. joins aliases linked by confirmed candidates into the identity of whichever was seen first, and
   returns an alias to its own identity when nothing joins it any more.

An older export imported late can therefore undo a suggestion it now sits in the middle of.

Only complete exports are compared. An export marked partial, or with a row excluded, cannot show
that a name is gone, so it is skipped for pairing and only records the names it lists; a pair whose
two names such an export lists at once is the collision `LISTED_TOGETHER`. Excluded rows, excluded
imports and exports not selected in a conflict group are no evidence of anything here.

Only counts are logged. Nothing any roster row said reaches a log line.

## Review

`roster.investigate` holders read and decide a Fleet's candidates — see
[the API](api-endpoints.md#get-fleet-communitiescommunityidfleetsfleetidroster-identitiescandidates).
A decision names the revision the reviewer saw, so two reviewers cannot both take the next one.
Nothing goes from confirmed to rejected without an undo between, and an undo must give a reason.

A decision touches no alias and no account. It asks for a replay in its own transaction, and the
replay's recompute is the only thing that moves an alias, and writes only roster tables. **A
confirmed account rename never changes an STO Info account handle.**

## Association proposals

After a replay publishes a revision whose latest effective export is not the one proposals were
last raised from, every registered Character whose full handle matches a counted row of that
export **exactly** — Character name and account handle, with the roster's leading `@` dropped — is
offered a proposal through `CharacterFleetProposalService.raiseFromEvidence`. Nothing reached
through a rename is proposed, and a replay that changed history but not the latest export asks
nobody anything again.

No proposal is raised when:

- the Character's owner could not see the Fleet anyway — anybody can register a Character under
  any name, and a proposal would otherwise tell them a hidden Fleet lists it;
- the owner has declined a proposal from that Fleet before;
- the owner has recorded a membership of that Fleet, current or ended.

An open proposal is returned rather than a second one raised. An expired one was never answered, so
the next import lapses it (`LAPSED`, the only status the site writes rather than a person) and asks
again, the new one naming the old in `replacesProposalId`. A proposal cites the import it rests on
and the instant that export was taken.

An unanswered proposal from a Fleet its owner can no longer see is left out of their list and
answered 404 until they can see it again.

The inbox notification for a proposal is W07's. Until then an owner sees proposals on their
Character's Fleet panel.

## After deploying

Fleets imported before FC-019 have no projection, and those imported before FC-018 no identities,
until their next import. Run once:

```bash
npm run fleet:replay-rosters -- --dry-run
npm run fleet:replay-rosters
```

It records a request and queues a job for each Fleet with an import in force, so running it twice
costs a wasted pass. It replaces FC-018's `fleet:backfill-identities`.

## How it is proved

| Check | What it covers |
| --- | --- |
| `roster-identity-matcher.spec.ts` | The corpus's Character rename, account rename and contribution reset fixtures through the real readers; every hard gate; every collision reason; grading; ordering |
| `roster-identity-planner.spec.ts` | Insert, rewrite, flag and delete rules for stored candidates; identity assignment, chains and undo |
| `roster-identity-recompute.service.spec.ts` | The whole pass against in-memory tables across successive recomputes |
| `roster-replay.service.spec.ts` | Proposals: raised from the latest effective export once, and finished after a crash |
| `roster-identity-review.service.spec.ts` | Listing, every transition and refusal, the revision check, the lock |
| `character-fleet-proposal.service.spec.ts` | Every reason not to ask, lapsing, deduplication and hiding |
| `roster-identity-schema-alignment.spec.ts` | The entities against the migration |
