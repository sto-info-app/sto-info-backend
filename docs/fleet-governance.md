# Fleet governance

Who governs a Community or Fleet: role labels, delegated capabilities, ownership and closure
(FC-022), and a site administrator's disputes, suspensions and looks into a Fleet (FC-036). The
code is in `src/fleet/governance`. The decisions below are Steve's, from 27 and 29 September
2026.

An Armada has roles and delegation too (FC-025): the Community's Owner appoints its Admins and
Officers from the approved members of the Fleets placed in it, and a role there ends when its
holder's Fleet leaves or they leave the Fleet. An Armada closes through its own route,
`DELETE /fleet-communities/:c/armadas/:a`, which ends its placements. See
[Fleet Armadas](fleet-armadas.md).

## Ownership

A Community has exactly one Owner: `fleet_community.ownerUserId`, one column, so there can never
be two or none. The Owner is Owner of every Fleet in the Community too; a Fleet has no Owner of
its own, and its leader is appointed Admin at that Fleet.

### Offering it

The Owner offers the Community to one of its Admins, who accepts or declines within seven days.
Either may act until then: the Owner can cancel, and the offer lapses unanswered. On acceptance:

- the Admin becomes the Owner, and the former Owner becomes an Admin;
- whatever role, grant or denial the new Owner held anywhere in the Community ends, because an
  Owner holds everything and a denial left behind would still take a power from them;
- the Community's name, slug and every Fleet's in-game identity are untouched.

The Admin is told by an in-app notification and by a panel on the Community's page. At most one
offer per Community is open (`UX_scope_ownership_transfer_open`), and an answered offer never
changes again (`TR_scope_ownership_transfer_guard`).

An offer is cancelled when it can no longer be kept: the Admin loses the role, the Community
closes, or a site administrator moves ownership.

### Concurrency

Every change to ownership locks the Community row first, then the offer. An acceptance and a
cancellation, two acceptances, or an acceptance and a dispute action are therefore taken one after
the other, and the second sees what the first did. This was rehearsed against the local database
with each pair run at once: exactly one of each pair succeeded every time, and the Community ended
with one Owner.

The ten-Communities-per-owner trigger applies to a transfer as to a registration. An Admin who
owns ten already is told so and the transfer does not happen.

### A site administrator's dispute action

For an Owner who has vanished or a Community that has been reported, a site administrator may:

- move ownership to one of the Community's Admins, with no acceptance; the former Owner keeps no
  role, and the new Owner may appoint them later;
- close the Community, or one of its Fleets or Armadas (FC-036);
- suspend or reinstate the Community, or one of its Fleets or Armadas (FC-036; see
  [Suspension](#suspension));
- look into one of its Fleets' imports, read-only, for 24 hours (FC-036; see
  [A site administrator's look into a Fleet](#a-site-administrators-look-into-a-fleet)).

Each needs a reason, or for a look a purpose, and each is logged as a site administrator's
(`asSiteAdmin`).

**Competing registrations (FC-036).** The dispute view lists each of the Community's Fleets and
Armadas with every other registration of the same exact name on the same platform, private ones
included, freshest first (`DisputeRegistrationsService`). Each shows where it came from: its
Community and that Community's Owner, when it was registered, its last roster import, its approved
members and who may see it. R02: STO Info cannot verify who leads a Fleet in the game, so nothing
here says which registration is real, and the page says so.

### An Owner closing their account

FC-038, Steve's decision of 29 September 2026. Each open Community goes to its longest-serving
Admin who can take it, logged as a reassignment by the departing Owner, with the reason "The Owner
closed their STO Info account."; the new Owner is told. One no Admin can take is closed. The
closure dialog says which first. A closed Community keeps no Owner once the account is erased. See
[Privacy: erasure](privacy-erasure.md#an-owner-closing-their-account).

### Suspension

FC-036, Steve's decision of 29 September 2026. A site administrator suspends a Community, Fleet or
Armada, with a reason, and reinstates it with another (`ScopeSuspensionService`).

- A suspended scope stays readable and accepts nothing new: the resolver withdraws every mutating
  capability there, as it does at a closed one, so nothing changes and nobody posts in its chat. A
  Community's suspension reaches its Fleets and Armadas.
- Unlike closure it ends nothing: roles, grants, memberships and events stand, and come back into
  force when it is reinstated.
- Only a site administrator suspends or reinstates a scope (`CHK_scope_governance_action_suspension`),
  and never a closed one. Suspending what is suspended, or reinstating what is active, changes
  nothing.
- Suspending a member, by a holder of `members.manage`, is recruitment's; see
  [Fleet recruitment](fleet-recruitment.md#leaving-and-removal).

### A site administrator's look into a Fleet

FC-036, Steve's decision of 29 September 2026. A site administrator gives a purpose (10 to 500
characters) on the dispute page, and may then read that Fleet's Investigate pages for 24 hours:
its imports and their rows, conflicting exports, identity decisions and rank order. They change
nothing, and there is still no way to see a raw roster file.

- The grant is a row in `fleet_investigation_grant` (write-once): who, which Fleet, why and until
  when. It is the record of the look.
- While it runs, the resolver gives that site administrator `roster.investigate.read` at that
  Fleet and nowhere else. It is not delegable, is in no role's baseline, and the grant confers it,
  not the site role. The Investigate read routes accept it beside `roster.investigate`; every
  correction route still needs `roster.investigate`.
- The audience rules let them open that Fleet's pages, and its Community's, while it runs.
- `GET /admin/fleet-investigations` lists every look, newest first, and `…/mine` the caller's
  open ones.

## Roles and delegation

Only the Owner changes roles and delegations. `scope.roles.manage` is the Owner's and cannot be
delegated, so an Admin is refused by the route guard before anything runs. The Owner and Admins
may read who governs a scope; nobody else may.

- **Roles.** The Owner appoints Admins and Officers from the scope's approved members: a Fleet's
  own members, or, at the Community, a member of any of its Fleets. One role per person per scope;
  changing it means withdrawing it first. A Community role reaches every Fleet in it.
- **Officers.** Per scope, the Owner sets which capabilities every Officer there holds. An
  Officer holds nothing else by default.
- **One person.** The Owner may grant or deny a single capability to one member or role holder.
  A denial beats every grant and every role.

### The ceiling

Only capabilities `delegableAt` names can be delegated: this feature's own scoped capabilities
that are marked delegable and mean something at that kind of scope. A site-wide permission such
as site ADMIN is not in this vocabulary at all, so a request cannot name one; and settings, role
management, ownership transfer and closure are not delegable. Every row is written at the scope
the route resolved, and a Fleet route pins its Community, so nothing here can reach another scope.

### Reasons

A reason is required whenever something is taken away: withdrawing a role, denying a capability,
clearing a granted one, a closure, and a dispute action. It is optional when appointing or
granting. The log's check constraints require it too, not only the service.

## Closure

Closing a Community or Fleet is a status change, never a deletion: the record, its web address,
its roster history and its past Armada placements all stay, and the resolver withdraws every
mutating capability from a closed scope. Closure also ends every role and capability grant held at
exactly that scope; their rows keep their dates. A closed Fleet also comes out of its Armada and
its open Armada request is cancelled (FC-024); see [Fleet Armadas](fleet-armadas.md#closure).
Memberships, recruitment, artwork and the Fleets inside a Community are left as they are. A reason
is required, and closing what is closed already changes nothing.

A member who leaves a Fleet, or is removed, loses any role and personal grant or denial held at
that Fleet with the membership.

Each role and grant a closure, a departure, a hand-over or an Armada rearrangement ends is logged
on its own (FC-039): a `ROLE_WITHDRAWN` or `CAPABILITY_CLEARED` row with no actor and a reason
naming the cause, keyed `ENDED:<id>` so a retry writes none twice. The history marks these rows
`automatic` and says what ended rather than who ended it. See
[Admin audit](admin-audit.md#endings-nobody-chose).

## The log

`scope_governance_action` records every change here, with who made it and why, in the
transaction that makes it: role assignments and withdrawals, capability grants, denials and
clearings, ownership offers and their answers, dispute actions, suspensions, reinstatements and
closures. It is append-only
(`TR_scope_governance_action_guard`); the one change it accepts is a named person's account, or
the offer it cites, going. The Manage pages show the newest 50.

It is the scope's history (FC-039): kept for as long as the scope exists, and read only by its
Owner and Admins. A site admin's dispute actions also show in the Security Log; see
[Admin audit](admin-audit.md#the-security-log).

## Routes

| Route | Who |
| --- | --- |
| `GET  /fleet-communities/:c/governance/roles` | The Owner or an Admin |
| `POST …/governance/roles` | `scope.roles.manage` |
| `POST …/governance/roles/:id/withdraw` | `scope.roles.manage` |
| `PUT  …/governance/officer-capabilities` | `scope.roles.manage` |
| `PUT  …/governance/personal-capabilities` | `scope.roles.manage` |
| `POST …/governance/personal-capabilities/:id/clear` | `scope.roles.manage` |
| `GET  …/governance/history` | The Owner or an Admin |
| `GET  …/governance/ownership` | Signed in; shows only the Owner or the Admin offered anything |
| `POST …/governance/ownership` | `scope.ownership.transfer` |
| `POST …/governance/ownership/:id/cancel` | `scope.ownership.transfer` |
| `POST …/governance/ownership/:id/accept` | The Admin offered it |
| `POST …/governance/ownership/:id/decline` | The Admin offered it |
| `POST …/governance/close` | `scope.close` |
| `… /fleet-communities/:c/fleets/:f/governance/…` | The same, less ownership, at one Fleet |
| `… /fleet-communities/:c/armadas/:a/governance/…` | The same, less ownership and closure, at one Armada |
| `GET  /admin/fleet-communities/:c/dispute` | Site ADMIN |
| `POST /admin/fleet-communities/:c/owner` | Site ADMIN |
| `POST /admin/fleet-communities/:c/close` | Site ADMIN |
| `POST /admin/fleet-communities/:c/suspend` and `…/reinstate` | Site ADMIN, with a reason |
| `POST /admin/fleet-communities/:c/fleets/:f/suspend`, `…/reinstate` and `…/close` | Site ADMIN, with a reason |
| `POST /admin/fleet-communities/:c/armadas/:a/suspend`, `…/reinstate` and `…/close` | Site ADMIN, with a reason |
| `POST /admin/fleet-communities/:c/fleets/:f/investigations` | Site ADMIN, with a purpose: a 24-hour read-only look |
| `GET  /admin/fleet-investigations` and `…/mine` | Site ADMIN |

The Community and Fleet close routes replace the earlier `DELETE` routes, which took no reason.
Every route is behind the Fleet Community switch.

The scope pages' `viewer` now also carries `roles`, the role labels the caller holds there, so a
page can tell an Admin from an Officer with delegated capabilities. It is display only.
