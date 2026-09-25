# Fleet reports

Who may see a Fleet's reports, and what each audience is shown (FC-020).

See also [Roster history](roster-history.md), which the reports are built from.

## Who may see a report

Plan R13 has Admins choose public aggregates. Steve decided on 25 September 2026 that the choice is
made per report, by the Owner alone — the holder of `scope.settings.manage`, which is not
delegable — from the Fleet's own four audiences:

| Audience | Who | What they see |
| --- | --- | --- |
| `PRIVATE`, the default | `reports.view` holders: the Owner and Admins | The report in full |
| `FLEET_MEMBERS` | The Fleet's approved members too | The report in full, since they can already read the roster it is built from |
| `COMMUNITY` | The Community's followers and members too | Aggregates only |
| `PUBLIC` | Anyone, signed in or not | Aggregates only |

For a report, `PRIVATE` means its `reports.view` holders, not the Owner alone as it does for a
Fleet record.

`fleet_report_audience` holds each report's audience once one has been chosen, and a report with
no row is `PRIVATE`. `fleet_report_audience_change` keeps every change, from what to what and who
made it, write-once. No reason is asked, as for the Owner's other settings. Two changes to one
report queue behind a lock, so each records the audience it really moved from. A change to the
audience a report already has is refused.

The Owner and Admins can read every report's audience and change. Anybody else learns only
whether a report is shown to them.

Nothing of a report is shown to anybody who may not see the Fleet itself. The Fleet's and its
Community's own audiences come first, so a public report on a Fleet visible only to its Community
stays hidden from everybody outside it. A report hidden from a viewer is reported as not found,
never as forbidden, so the answer does not confirm what a private Fleet has.

## What an aggregate audience is shown

The Community's followers and anybody else see counts and totals only: never a name, a handle, a
comment or a member's own figure, and no drilldown to them. Every figure is hidden — null in the
API and `< 5` in an export — when it counts from 1 to 4 members (Steve's decision of 25 September
2026). Where that hides exactly one count in a group that makes up a whole, such as a report's
bands or rank labels, the smallest count still shown is hidden too, so the first cannot be got
back by subtraction. A contribution total is hidden when fewer than five members' deltas make it
up.

Members are counted as roster identities: a Character, across its renames. One member listed twice
on an export, when both names of a confirmed rename are still listed, counts once. Where a report
counts accounts too, they are observed account handles, never people.

## What every report says about itself

Each reads the published revision alone, over a span — every effective export by default, or those
taken between `from` and `to` — and says which revision, over which span and from how many exports.
A full view also draws detail at one export: the latest in the span, or the one asked for with
`at`.

## The reports

The roster history's five: `GROWTH`, `TENURE`, `RANKS`, `ACTIVITY` and `CONTRIBUTION`. Holdings,
recruitment and event attendance join them with their own stories.

Every count is taken in the database, grouped by export, so a Fleet with hundreds of exports is
read a row per export and band rather than a row per member. None reads a row an investigator
excluded.

### Growth

FC-019's interval summaries, one row per interval between two consecutive effective exports:
members at each end, and how many joined, rejoined and left, were left unknown by a partial
export, or were revealed across a gap. Beside them, the account handles each end listed — observed
accounts, never people (Steve's decision of 25 September 2026).

For an aggregate audience, the five movements are one group: with the members at each end shown,
any one of them could otherwise be worked out from the rest.

### Activity

Each export's members, banded by how long before the export's own instant their latest Last
Active was: within 7, 30 or 90 days, longer, or not given (Steve's decision of 25 September 2026).
A Last Active after the export, which a clock or zone mismatch can give, is within 7 days. The
bands are one group, beside the total they make up.
