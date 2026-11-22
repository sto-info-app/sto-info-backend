# Operations runbooks

How the site and the file scan worker are run, and what to do when something goes wrong (FC-042).
Each page is written to be followed under pressure: the steps are numbered, and the reasoning
behind them is in the pages they link to.

| Page                                                    | Use it when                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Render services](render-services.md)                   | Setting up or changing a service, a secret or a plan; checking the connection budgets          |
| [Readiness and heartbeats](readiness-and-heartbeats.md) | Asking whether the API is up, and whether the worker is scanning, paused, idle or gone         |
| [Scanner signatures](scanner-signatures.md)             | `SIGNATURES_STALE` is open, or the worker has paused with `SIGNATURES_TOO_OLD`                 |
| [Alerts](alerts.md)                                     | An operations alert has arrived                                                                |
| [Failed jobs](failed-jobs.md)                           | `FAILED_JOBS` is open: retrying or discarding what a queue gave up on                          |
| [Restore](restore.md)                                   | Restoring the database from a backup                                                           |
| [Rollback](rollback.md)                                 | A release has gone wrong, and at release time for retiring the old credentials                 |
| [Incidents](incidents.md)                               | Anything is wrong and you are not yet sure what: recognise, contain, diagnose, recover, record |
| [Rehearsal](rehearsal.md)                               | Rehearsing these runbooks on the local Docker stack                                            |

Creating the Render services, and rehearsing these runbooks on them, is FC-052
([#1287](https://app.shortcut.com/startrekonlineinfo/story/1287)), done last. Anything marked
**to confirm on Render (FC-052)** has not been checked against the live account yet.

## Principles

- **Fail closed.** An outage stops publication; it never opens quarantine. When the scanner, the
  queue, a bucket or the database cannot be trusted, uploads wait rather than being published
  unscanned. Every mechanism below is built that way: the worker pauses itself rather than scanning
  with old signatures, the API does not start until the restore check has read the ledgers, and an
  unreadable publication switch counts as paused.
- **The file gate is never governed by a feature switch.** Scanning, quarantine and publication
  are site-wide services, and no Fleet, Storytime or Custom Tracking switch can stand them down
  (requirement R24; see `src/fleet/constants/fleet-feature.constants.ts`). The publication pause is
  an operations kill switch, not a feature switch: no feature switch governs it, and it governs
  none.
- **The database is the authority.** Redis carries messages, not truth. An attempt's result lives
  in the worker's `file_scan_attempt` row, the publication pause lives in `app_setting` and is
  re-applied to the queue every minute, and the four ledgers outside the database exist only to
  put back what a restore took away.
- **Roll forward rather than revert.** The FC-042 migrations refuse to revert once they matter,
  and a build from before FC-012 must never run again. A bad release is fixed by a new one; see
  [Rollback](rollback.md).

## Who may act

Site admins: accounts with the `ADMIN` role. The role cannot be granted through the API; it is
appointed out of band, by the `ADMIN_EMAIL` variable the role migration reads or by an `UPDATE`
against the database (see [Backend](../backend.md)). Every control these runbooks use —
Scan Diagnostics, retrying and discarding failed jobs, pausing publication, the image estate,
rescan campaigns and roster erasure — needs it.

Changes on Render, in AWS Secrets Manager and in Cloudflare need access to those accounts, which is
separate from the site's roles.

## Where everything is logged

- **The Security Log** (Admin › Security Log, `/admin/security-log`). Every site admin action,
  with its reason: `PUBLICATION_PAUSED`, `PUBLICATION_RESUMED`, `SCAN_JOB_RETRIED`,
  `SCAN_JOB_DISCARDED`, one `SCAN_DIAGNOSTICS_VIEWED` per view of the diagnostics, and
  `LEDGERS_RECONCILED` when the restore check brings anything back. See
  [Admin audit](../admin-audit.md#operations-fc-042). Entries are deleted after
  `AUDIT_DATA_NUKE_THRESHOLD_DAYS`, so copy what an incident record needs before then.
- **Scan Diagnostics** (Admin › Scan Diagnostics, `/admin/scan-diagnostics`). The scanner, the
  worker heartbeats, the queue, the uploads awaiting a verdict, the open alerts and the failed
  jobs. The publication pause is on the Admin page's Publication panel. See
  [File assets](../file-assets.md#watching-the-scanner-get-adminfile-scanningdiagnostics).
- **Notifications.** Every site admin is told once when an operations alert opens and once when it
  clears. See [Alerts](alerts.md).
- **The service logs on Render.** The backend's and the worker's. The lines worth searching for are
  named on each page.
