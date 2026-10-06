# Release rehearsal

Rehearses the Fleet Community v1 release from production as it is (FC-045): production's schema,
made by production's own migrations and filled with production-shaped rows, migrated to this
release, and then switched, rolled back and broken on purpose.

```bash
npm run rehearse:release
```

It runs on the [operations rehearsal](../operations-rehearsal/README.md)'s throwaway stack — the
same containers, builds, generated secrets and egress guard — and needs what that needs: Docker,
and the worker checked out beside this repository with `npm ci` done in both
(`REHEARSAL_WORKER_REPO` names a worker elsewhere). It always builds the production release
(`REHEARSAL_OLD_REF`, default `origin/production`) with `git archive`, which takes a few minutes. A
run takes about ten minutes.

## No real data

Steve's decision of 6 October 2026: the rehearsal is synthetic. Nothing is read from production or
from any `.env`. The rows are production's own demo seed (118 members with their accounts and
Characters) and [`sql/production-seed.sql`](sql/production-seed.sql), which adds a row of every kind
the release's migrations read or change: preferences to move, entered days with a time of day,
pictures in every column the backfill reads (a Character whose picture is still its name among
them), site news, notifications, Storytime, Custom Tracking, audit snapshots, reports, and both
feature switches on.

Production's migrations run as `start:render` runs them, through ts-node on its own configuration.
`NODE_ENV` is `local` only so that the throwaway database needs no TLS and the demo seed runs; the
local Fleet seeds are given no variables, so they do nothing, as in production.

## What it rehearses

| Part | What it does | What must hold |
| --- | --- | --- |
| R1 Production as it is | Production's migrations on an empty database, a site admin, then the seed; the [preflight](../release-preflight/preflight.sql) | The schema is production's (last migration `1791500000000`); the preflight passes, and its counts of what the release will change are recorded |
| R2 Migrating | This release's migrations, timed | Every one since production applies, in one transaction |
| R3 Nothing accepted is lost | Every table that existed before, compared with a copy taken before migrating: every row, every column that remains | Identical, but for the release's intended changes, each checked on its own: preferences moved to `user_preference` exactly; entered days as dates; every news post still the site's own; one new notification, the policy notice; Fleet off, the other switches as they were; every legacy picture registered once and unverified, and no Character name; audit snapshots of news, contact requests and member reports keeping their identifiers only; an unregistered picture refused (`IRG01`) |
| R4 Feature switch | Boots this release; a member and a site admin sign in; the site admin switches Fleet Community on, registers a Community and a Fleet, and switches it off, on and off again | Fleet starts off and its routes answer as though it did not exist; each change takes effect within ten seconds, is logged with its reason, and a repeated one is refused; what was registered is kept while off and back when on; renaming a platform a Fleet is on is refused (`IRG02`); site news is unchanged throughout |
| R5 Rolling back | `migration:revert` on a copy, then forward again; the production release booted on the migrated database | The platform guard and the name clearing revert, and the feature switch log refuses; forward again works. The production release's behaviour is recorded: the rollback runbook forbids rolling production back below this release |
| R6 What the preflight looks for | Each row the preflight looks for planted in a copy of the database as it was before the release | The preflight fails on it, the release's migrations fail on it, and the copy is left exactly as it was |

Results go to `REHEARSAL_RESULTS` as Markdown, with the applications' and migrations' logs beside
it, as the operations rehearsal's do. They are not committed; the release evidence, kept with the
Fleet Community plans, records a run.
