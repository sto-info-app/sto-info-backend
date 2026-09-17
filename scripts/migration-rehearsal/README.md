# Migration rehearsal

Runs a migration against a real, throwaway PostgreSQL instance and then tries to break every
rule it claims to enforce.

```bash
npm run rehearse:migration
```

That rehearses the Fleet Community schema. To rehearse a different migration:

```bash
npm run rehearse:migration -- src/database/migrations/<migration>.ts <suite>
```

where `<suite>` selects `sql/<suite>-seed.sql` and `sql/<suite>-assert.sql`.

## Why this exists alongside the unit specs

The specs under `src/database/migrations/__tests__` assert the SQL a migration *emits*. That
catches a partial unique index quietly becoming a full one, or a `timestamptz` column reverting
to a plain `TIMESTAMP`. What it cannot tell you is whether PostgreSQL accepts the SQL at all, or
whether a constraint that reads correctly actually rejects the row it is meant to reject. Those
only show up against a database, and the first place they would otherwise show up is a deploy.

Two things in particular are not provable any other way:

- **Rollback over real rows.** Rolling back an empty schema proves very little. This rolls back
  after the assertions have left data behind, which is the case that goes wrong.
- **Concurrency.** "One current membership per Character **under concurrent writes**" is not
  demonstrated by inserting twice in one session — that only shows the index exists. The race
  script runs many writers at once and checks exactly one commits.

## What a run does

1. Records the migration's `up` and `down` SQL without a database
   (`emit-migration-sql.ts` hands it a query runner that collects statements instead of
   executing them, so this is what TypeORM would send rather than a transcription of it).
2. Starts `postgres:17-alpine` in a container.
3. Creates the stub parent tables from `sql/stubs.sql`.
4. Applies `up`, seeds, and runs the assertion suite.
5. Races concurrent writers against the invariants that are worded that way.
6. Applies `down` **with data present**, and checks nothing but the stubs and no enum type
   survived.
7. Applies `up` again to the same database.

## Safety

It reads no database environment variable and opens no network connection to a database. Every
statement goes through `docker exec` into the container this script started, so it cannot be
pointed at a developer or hosted database by a stray `.env`. The container is named after the
process ID and is removed on exit, including on failure or interrupt.

## The stub tables

`sql/stubs.sql` holds stand-ins for the tables an earlier migration created — `user`,
`platform`, `character`, `character_general_faction` — carrying only the columns the foreign keys
under rehearsal need. Using stubs rather than replaying the whole migration history keeps a
rehearsal independent of every migration before it, and keeps it fast. It also means a rehearsal
says nothing about interactions with real data in those tables; that is what a staging restore is
for.

## Adding a suite

Add `sql/<suite>-seed.sql` and `sql/<suite>-assert.sql`. The assertion file gets three helpers,
defined at the top of the Fleet Community one and worth copying:

- `expect_rejected(label, statement, sqlstate)` — fails the run if the database **accepts** the
  statement, or rejects it with a different error than the one named.
- `expect_accepted(label, statement)` — fails if it is rejected.
- `expect_true(label, query)` — fails unless the query returns true.

Name the SQLSTATE you expect rather than accepting any failure. `23505` is a unique violation,
`23514` a check violation, `23503` a foreign-key violation — and a test that passes because the
statement had a typo in it is worse than no test.
