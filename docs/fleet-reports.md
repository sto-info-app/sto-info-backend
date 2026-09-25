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

## The reports

The roster history's five: `GROWTH`, `TENURE`, `RANKS`, `ACTIVITY` and `CONTRIBUTION`. Holdings,
recruitment and event attendance join them with their own stories.
