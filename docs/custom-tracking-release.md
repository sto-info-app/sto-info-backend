# Custom Tracking — release and rollback

What was rehearsed, in what order it goes out, and how to take it back.

## The shape of the release

Custom Tracking adds nine tables and touches nothing that already exists. No
column is altered, no data is migrated, and nothing outside the feature reads
the new tables. That is what makes the ordering below safe rather than
merely conventional: at every step, the half that is already deployed works
whether or not the other half is.

The master switch, `CUSTOM_TRACKING_ENABLED`, ships **off**. It lives in the
`app_setting` table rather than in the environment, so the feature can be
turned on — and taken off again during an incident — without a deployment.

## Order

1. **Migrations and backend together.** The backend runs its migrations on
   start (`start:render`), so this is one step rather than two.
2. **Confirm the switch is off.** It is off by default and the seed does not
   turn it on. Worth reading rather than assuming.
3. **Frontend.**
4. **Turn the switch on** when both halves are up and smoke-tested.

Between steps 1 and 3 the API exists and answers, but no interface reaches it
and the switch refuses it anyway. Between 3 and 4 the Settings entry is
present and says the feature is switched off, which is the state it is designed
to sit in — that message exists precisely so that this window is not a fault.

The capability flags (`CUSTOM_TRACKING_PUBLIC_READ_ENABLED`,
`..._DEFINITION_EDITING_ENABLED`, `..._VALUE_EDITING_ENABLED`,
`..._IMAGES_ENABLED`, `..._YOUTUBE_ENABLED`) all default on and are there to
stage a narrower rollout if one is wanted. A capability that is off answers
`404` rather than a "disabled" error, so a staged rollout does not advertise
what is coming.

## Migration rehearsal

Rehearsed against a copy of the local development database, which carries the
seeded members, accounts and captains.

| Step                                    | Result                                    |
| --------------------------------------- | ----------------------------------------- |
| Forward, all three migrations           | Applied; nine tables and three enum types. |
| Rollback, all three                     | Clean: no tables, no enum types, no stray columns left behind. |
| Forward again from the rolled-back state | Applied; identical schema.                |

The third step is the one worth doing. A migration that only ever runs once on
a fresh database can hide an assumption about what is already there, and a
rollback is not proven until the way forward has been walked twice.

The rehearsal also turned up an inconsistency: the queue table generated its
identifiers with `uuid_generate_v4()` while the rest of the feature used
`gen_random_uuid()`. Both work, and ten older migrations use the former, but
the former needs the `uuid-ossp` extension installed and there was no reason
for one table of nine to be the one that needed it. Now aligned, and pinned by
a test.

To repeat the rehearsal:

```bash
npm run migration:show     # what is pending
npm run migration:run      # forward
npm run migration:revert   # three times, newest first
npm run migration:run      # forward again
```

## Rollback

In the order that keeps the site working at every step, which is the reverse of
the release:

1. **Turn the switch off.** This is the whole rollback for almost every
   problem. Everything already recorded is untouched and invisible, the
   Settings page says so, and nothing is lost.
2. **Roll the frontend back** if the fault is in the interface.
3. **Roll the backend back** if the fault is in the API. The tables can stay:
   nothing else reads them, and leaving them costs nothing.
4. **Revert the migrations** only if the schema itself must go, and only once
   it is accepted that everything members have recorded goes with it. Three
   `migration:revert` runs, newest first.

Step 4 is the only irreversible one, and by then the 180-day retention promise
is being broken on purpose rather than by accident. It should not be reached
without a decision made by a person.

## After it is on

Worth watching for the first few days:

- **`CustomTracking` log entries.** The feature logs limit refusals, value
  refusals, upload failures and what the nightly sweep did — never anything a
  member wrote. A rash of value refusals of one field type usually means a
  control that is harder to use than it looked.
- **`custom_tracking_image_cleanup` row count.** It should be near zero most of
  the time. A row that reaches ten attempts is logged at error level and named;
  a backlog that is growing means Cloudflare deletions are failing.
- **Table growth.** Nine new tables on a site whose members have not had this
  before. The per-scope and per-tab ceilings bound it, but the ceilings were
  chosen from guesswork about what people would want, and the first weeks are
  the evidence.
- **The nightly job's duration.** It runs last in the pipeline and sweeps at
  most 500 rows per table, so it should be quick and stay quick.

## What is deliberately not automated

There is no admin console for moderation, and no import or export. Both were
decided against earlier in the build rather than left out for time; see
`docs/custom-tracking.md`.
