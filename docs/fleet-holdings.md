# Fleet holdings

The tier of each of a Fleet's holdings, recorded by hand, and how it changed (FC-023). The code
is in `src/fleet/holdings`. The decisions below are Steve's, from 28 September 2026.

There is no XP here, and nothing is worked out from contributions: a tier is what somebody
recorded, and nothing else sets it.

## The catalogue

Seven holdings, read from the STO Wiki on 28 September 2026. Each has a track of its own and two or
three departments, and every track has its own tiers from 0, meaning not started:

| Holding | Tiers | Departments, each with the same tiers |
| --- | --- | --- |
| Fleet Starbase | 0–5 | Military, Engineering, Science |
| Fleet Embassy | 0–3 | Diplomacy, Recruitment |
| Fleet Dilithium Mine | 0–3 | Trade, Development |
| Fleet Spire | 0–3 | Research, Operations |
| Fleet Research Lab | 0–3 | Research, Development |
| Deep Space K-13 | 0–3 | Retrofit Engineering, Xenotech Research |
| Fleet Colony World | 0–5 | Morale, Infrastructure, Renewable Energy |

Every track at its highest makes a Fleet level 85, as the wiki says.

The catalogue is reference data in three tables: `fleet_holding_type`, `fleet_holding_track` and
`fleet_holding_tier`. Each holding keeps the wiki page it was read from (`sourceUrl`), the day that
page was last edited (`sourceEditedOn`) and the catalogue version that last changed it
(`catalogueVersion`). `CreateFleetHoldings1795400000000` seeds version 1. Any later change is a
new, reviewed migration that raises the version on the holdings it touches.

## Recording

- **Who:** holders of `holdings.write` at the Fleet. By default that is the Owner and the Fleet's
  Admins; the Owner can delegate it to Officers or to one person. A Community role reaches every
  Fleet in it.
- **What:** one save records one holding: its own tier and any of its departments'. Each track
  is checked against its own tiers only; the tracks are not checked against each other.
- **Tiers** may go down as well as up, to correct a mistake. A reason is optional either way.
- **Before anything is recorded,** every track is at tier 0, and there is no history.
- **A closed Fleet's** holdings cannot change. Its history stays readable.

Every recorded tier references `fleet_holding_tier`, so the database itself refuses a tier the
catalogue does not list, a track of another holding, or a move to the tier a track is at already.

### Concurrency

A save locks the Fleet's row first. Two recorders are therefore taken one at a time, and each
history row says truly what the track moved from. This was rehearsed against the local database
with eight saves of one track at once: each move started where the one before it ended, and the
current tier matched the last move.

## History

`fleet_holding_change` is one save, with who made it, when and why. `fleet_holding_history` holds
the tracks it moved, from what tier to what. Both are write-once, by trigger; the one change either
accepts is the recorder's account being deleted. `fleet_holding_status` keeps where each track
stands now, so reading a Fleet's holdings does not replay its history.

## Who sees it

Holdings are public: whoever may see the Fleet sees its tiers and their history, signed in or not.
There is no audience to choose, unlike the Fleet's reports. Who recorded each change is shown to
the Fleet's members (`roster.view`) and to `holdings.write` holders only; anybody else sees the
change without a name.

## Routes

| Route | Who |
| --- | --- |
| `GET /fleet-communities/:c/fleets/:f/holdings` | Anybody who may see the Fleet |
| `GET …/holdings/history?page=&pageSize=` | Anybody who may see the Fleet; newest first, 25 a page by default, at most 100 |
| `PUT …/holdings/:holdingCode` | `holdings.write` at the Fleet |

The `PUT` takes `{ tiers: [{ track, tier }], reason? }`. Tracks left out stay as they are. It is
refused with 400 for a track of another holding, a track given twice, a tier out of range, or
nothing that changes; with 404 for an unknown holding; and with 409 for a closed Fleet. It answers
with the Fleet's holdings as they now stand. Every route is behind the Fleet Community switch.
