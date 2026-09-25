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
2026). In a group that makes up a whole, such as a report's bands or rank labels, the smallest
counts still shown are then hidden too, one by one, until the hidden counts together count at
least five, or every count is hidden. Otherwise a hidden count could be got back by subtracting
the rest from a total shown beside them. A zero goes first, as it gives the least away. A
contribution total is hidden when fewer than five members' deltas make it up.

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

### Tenure

Observed, never the game's Join Date (Steve's decision of 25 September 2026). Each export's members
are banded by how long before it the episode it falls in was first listed: under 30 days, 30 to
90, 90 days to a year, one to two years, or two or more. A member whose episode no earlier export
bounds — first seen on the Fleet's first export, or after exports that did not list them either
way — had been listed at least that long, and each band says how many of its members that is.

A full view also lists the members at one export, longest listed first, each named as that export
listed them.

### Ranks

Each export's members under each rank label, ordered by the Fleet's [rank
order](roster-history.md#rank-order) with unplaced labels last. A member listed twice under two
labels, both names of a confirmed rename holding different ranks, counts under each.

Beside them, the rank changes each export revealed since the one before. A move between two tiers
is a promotion or a demotion; every other change of label is only "changed". Changes bounded more
widely than the interval are counted apart. The Fleet's first export reveals none, and an export
that starts a later span still shows its own.

For an aggregate audience, each export's labels are one group, and so are its changes.
