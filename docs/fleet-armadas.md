# Fleet Armadas

How Fleets are arranged in Armadas: requests to join, where each Fleet sits, moves and
departures, and the history (FC-024 to FC-026). The code is in `src/fleet/armadas`; the placement
rules themselves are plain functions in `utilities/armada-arrangement.utility.ts`, so the Fleet
domain and governance can end placements on closure without depending on the module. The decisions
below are Steve's, from 28 September 2026.

An Armada is optional: a Community holds Fleets directly, and an Armada groups some of them. It is
a manual, temporal association, never read from a roster export.

## The structure

Star Trek Online's own: one Alpha, up to three Betas, and up to three Gammas under each Beta.

- **Same Community, same platform.** An Armada takes only its own Community's Fleets, by composite
  foreign key, and only on its own platform.
- **Same allegiance.** An Armada is Federation or Klingon, chosen at registration, and a Fleet
  must share it exactly. A Fleet whose allegiance is unset or Undecided cannot join. An Armada's
  allegiance cannot change while a Fleet is placed in it, and a placed Fleet's cannot change at
  all. Resolving an Armada's address answers its allegiance by name (`allegianceName`), since a
  signed-out reader cannot ask the character lookup what the id means.
- **The Alpha slot may stand empty.** A Beta reports to the slot, not to one Alpha's placement,
  so the Alpha can leave without taking the Betas with it. Only a Gamma names a parent: the Beta
  it sits under (`CHK_armada_fleet_membership_parent`).
- **One place at a time.** A Fleet has at most one open placement anywhere
  (`UX_armada_fleet_membership_open_fleet`), and an Armada one Alpha
  (`UX_armada_fleet_membership_open_alpha`).

Every change locks the Armada's row first, works out where every Fleet would sit afterwards and
checks the whole of it, so a change that would leave a Gamma under nothing, or give a Beta a
fourth Gamma, is refused before anything is written. The refusal names what does not fit.

## Joining

A Fleet joins only by asking, and an Armada manager answering.

- **Asking** needs `armada.request` at the Fleet: its Owner and Admins by default, delegable to
  Officers. The request carries an optional message. A Fleet has one open request at a time
  (`UX_armada_join_request_open`), may withdraw it, and it lapses after 14 days.
- **Answering** needs `armada.manage` at the Armada: the Community's Owner and Admins, and the
  Armada's own Admins. The approver chooses where the Fleet goes, Alpha, Beta or Gamma under a
  chosen Beta, from what has room. A rejection needs a reason, which the requester is shown.
- **An answered request never changes** (`TR_armada_join_request_guard`), and an approval names
  the placement it made.

The requester is told in-app of an approval, a rejection with its reason, and a lapse. An hourly
sweep marks requests past their time `LAPSED` and tells each requester; a request found lapsed
while another is being made is replaced without a notification.

## Moving and leaving

- **Moving** a placed Fleet needs `armada.manage` and a reason. When a Beta stops being one, the
  manager says what becomes of each of its Gammas: moved under another Beta with room, made a
  Beta if there is room, or taken out too, all in the same change.
- **Removing** a Fleet needs `armada.manage` and a reason, with the same choice for a Beta's
  Gammas. Each removed Fleet's Owner and Admins are told in-app, with the reason.
- **Leaving** needs `armada.request` at the Fleet and a reason. A Beta with Gammas under it cannot
  leave on its own, because the Gammas belong to other Fleets: an Armada manager has to move or
  remove them first.

A Fleet that moves ends its placement and starts another, so where it was stays readable. A
placement can only be ended (`TR_armada_fleet_membership_guard`).

## Closure

- **Closing an Armada** ends every open placement and cancels every open request in the same
  transaction, so its Fleets are free to join another. Its Owner closes it with
  `POST /fleet-communities/:c/armadas/:a/governance/close` and a reason (`scope.close`, which no
  Admin holds), from the Armada's Manage page, and the reason is kept in its governance history
  (FC-050). The reasonless `DELETE` it replaced is gone. A site administrator closes one with a
  reason; see [Fleet governance](fleet-governance.md#routes).
- **Closing a Fleet** ends its placement and cancels its open request. If it was a Beta, its
  Gammas become Betas where there is room, in the order they were placed, and otherwise leave;
  the history records the change with the reason "*Fleet* closed.".

## Membership and roles

- **Armada members.** An approved member of a Fleet placed in an Armada is that Armada's member
  for as long as the Fleet stays. The authorisation policy works this out afresh on every
  question, from the open placements, so it ends the moment the Fleet leaves. It brings the
  member baseline, narrowed to what means something at an Armada: sharing an Armada never opens
  another Fleet's roster (ADR-0009). Each placement change moves the Armada's authorisation
  revision on.
- **Armada roles.** The Community's Owner appoints Admins and Officers at an Armada, and delegates
  capabilities there, on the Armada's Manage pages, from the approved members of the Fleets placed
  in it. A role or personal grant there ends, logged with a reason, when its holder is no longer
  one of those members: when their Fleet leaves the Armada, or they leave the Fleet.

## History

`armada_action` records each placement, move, departure, removal and end by closure, from where
to where, grouped by the change that made it (`changeId`), with who made it and why. A move, a
departure and a removal need a reason, by check constraint. It is write-once
(`TR_armada_action_guard`); the one change it accepts is a named person's account, or the request
it cites, going.

Whoever may see the Armada sees its shape and history. Who made each change, and why, is shown to
its members and role holders only. A Fleet the reader may not see keeps its place in the tree and
the history without its name or link.

## Routes

| Route | Who |
| --- | --- |
| `GET /fleet-communities/:c/structure` | Anybody who may see the Community: each open Armada's shape, then its open Fleets in none |
| `GET …/armadas/:a/structure` | Anybody who may see the Armada |
| `GET …/armadas/:a/history?page=&pageSize=` | Anybody who may see the Armada; newest change first |
| `GET …/armadas/:a/requests?status=&page=&pageSize=` | `armada.manage`; open requests by default |
| `POST …/armadas/:a/requests/:r/approve` | `armada.manage`; `{ position, parentFleetId? }` |
| `POST …/armadas/:a/requests/:r/reject` | `armada.manage`; `{ reason }` |
| `POST …/armadas/:a/placements/:f/move` | `armada.manage`; `{ position, parentFleetId?, reason, gammas? }` |
| `POST …/armadas/:a/placements/:f/remove` | `armada.manage`; `{ reason, gammas? }` |
| `GET …/fleets/:f/armada` | Anybody who may see the Fleet; its requests and choices for `armada.request` holders |
| `POST …/fleets/:f/armada/requests` | `armada.request`; `{ armadaId, message? }` |
| `POST …/fleets/:f/armada/requests/:r/withdraw` | `armada.request` |
| `POST …/fleets/:f/armada/leave` | `armada.request`; `{ reason }` |
| `… /armadas/:a/governance/…` | Roles and delegation, as for a Fleet — see [Fleet governance](fleet-governance.md#routes) |

Each of `gammas` is `{ fleetId, outcome: 'BETA' | 'GAMMA' | 'LEAVE', parentFleetId? }`. Every
route is behind the Fleet Community switch.
