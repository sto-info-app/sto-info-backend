# Fleet activity

Activity feeds for Communities, Fleets and Armadas, a feed of each person's own, and the one
targeted notice FC-029 adds (FC-029). The code is in `src/fleet/activity`. The decisions below are
Steve's, from 28 September 2026.

## What goes on a feed

| Type | Recorded when | Scope | Shown to |
| --- | --- | --- | --- |
| `NEWS_PUBLISHED` | A draft is published, or published again after going back to a draft | The post's | Whoever may read the post now |
| `EVENT_CREATED`, `EVENT_CANCELLED` | An event is created, or cancelled | The event's | Whoever the event is shown to now |
| `OCCURRENCE_CANCELLED`, `OCCURRENCE_MOVED` | A manager cancels or moves one occurrence | The event's | Whoever the event is shown to now |
| `MEMBER_JOINED`, `MEMBER_LEFT`, `MEMBER_REMOVED` | A membership is granted, left, or removed | The Fleet's | Its members |
| `ROSTER_IMPORTED` | A replay publishes a new latest export | The Fleet's | Its members |
| `HOLDINGS_RECORDED` | A holding's tiers are recorded | The Fleet's | Whoever may see the Fleet |
| `ARMADA_FLEET_PLACED`, `ARMADA_FLEET_MOVED`, `ARMADA_FLEET_LEFT` | A Fleet is placed in, moved within, or leaves or is taken out of an Armada | The Armada's and the Fleet's, one item each | Whoever may see that scope |
| `ROLE_APPOINTED`, `ROLE_WITHDRAWN` | A role is given or taken away | The role's | Its members |
| `OWNERSHIP_TRANSFERRED` | An offer is accepted, or a site administrator reassigns ownership | The Community's | Its members |
| `SCOPE_CLOSED` | A Community, Fleet or Armada closes | Its own | Its members |

Routine activity is feed, never inbox: none of these sends a notification.

- **References, never text.** An item names its scope, what happened, who did it and who it
  happened to, the record it is about, and counts or positions in `detail`. Never a name, a title,
  a reason or a line of a roster. A removal's reason stays in the membership's log.
- **Roster imports are counts.** Members listed, and how many joined and left since the export
  before. The first export counts nobody as joining. An earlier export filled in behind the latest
  adds nothing. R15 keeps it member-only.
- **An Armada closing** is one item, on the Armada's feed. The Fleets it lets go add none.
- **Recorded once.** Each item is written in the transaction making the change, by
  `recordActivity`, a plain function taking the transaction, so a feature needs nothing of this
  module. `idempotencyKey` is unique and the insert ignores a duplicate, so a replay or a retry
  writes nothing more. Each key starts with the type and names the change: the membership's log
  line, the import, the holding change, the Armada change and Fleet, the governance entry, the
  event or occurrence, or the post and its publication instant.
- **Kept twelve months.** A daily job (03:41 UTC) forgets anything older.

## Who sees what

Every item is asked about again at every read. The reader must see the item's scope at all, then
its own rule — the scope's visibility, its members only (`FleetAudience.FLEET_MEMBERS` at the
scope), or its source's audience as it stands now. Nothing is shown from what was true when it was
recorded. So a post taken back to a draft, an event narrowed to officers, or a member who has left
reads as it is now.

Each item is written as a sentence from current data. People are named by username and nothing
else, and Somebody where there is no username. An item whose Fleet, Armada, holding, post or event
has gone is left out rather than half-written. Each links to where to read more: the post, the
event, the Fleet's holdings or roster history, the Armada, or the scope.

## Feeds

- **A scope's feed** is its own items only: a Community's feed is not its Fleets' and Armadas'. It
  is not found for a reader who may not see the scope.
- **Somebody's own feed** gathers every scope of each Community they follow or own, and each Fleet
  or Armada elsewhere they are an approved member of or hold a role in.

A page is twenty items, newest first. The cursor is `<ISO instant>_<item ID>`; a page reads at most
five batches of fifty, so a long run of items the reader may not see hands back a cursor rather
than reading the whole feed.

## The proposal notice

A Fleet asking whether somebody's Character is in it tells them, once, through the notification
outbox (`ROSTER_ASSOCIATION_PROPOSED`). It is queued in the transaction raising the proposal, only
when a new one is raised, keyed `ROSTER_ASSOCIATION_PROPOSED:<proposal>`. At delivery
`ProposalNoticeHandler` sets it aside unless the proposal is still pending and unexpired, the
Character is still theirs, and they may still see the Fleet. The outbox asks their Fleet
notification preference itself. It links to the Character's page, where they answer it.

## Routes

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/fleet-communities/:communityId/activity` | Anybody who may see the Community, signed in or not |
| `GET` | `/fleet-communities/:communityId/fleets/:fleetId/activity` | Anybody who may see the Fleet |
| `GET` | `/fleet-communities/:communityId/armadas/:armadaId/activity` | Anybody who may see the Armada |
| `GET` | `/fleet-activity/mine` | Anybody signed in |

Each takes `before`, a cursor from the page before, and returns `{ items, next }`. An item is
`{ id, type, occurredAt, sentence, path, scope: { kind, name, path } }`. Paths are the site's.
Every route needs the Fleet feature.

## The schema

`activity_event`, made by `CreateActivityFeed1795800000000`, with the enum types
`activity_type_enum` and `activity_visibility_enum`.

- `UQ_activity_event_idempotency` makes each item once.
- `CHK_activity_event_scope` allows a Fleet or an Armada, not both.
- The Fleet and Armada keys are composite with the Community, and everything goes with its
  Community, Fleet or Armada. The people it names are set to nobody when their accounts go.
- It is read by scope and instant (`IDX_activity_event_scope`) and purged by instant
  (`IDX_activity_event_occurred`).

Rehearsed against the local database: an item recorded twice was kept once, the cursor carried on
past items at the same instant, visibility came from the type, and an item naming a Fleet and an
Armada was refused (23514). The composite key was not rehearsed, because the local database holds
no Fleet of another Community.
