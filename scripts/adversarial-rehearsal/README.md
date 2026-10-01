# Adversarial rehearsal

Runs plan section 11's adversarial matrix (FC-043) against the real backend and the real worker,
on the [operations rehearsal](../operations-rehearsal/README.md)'s throwaway stack: the same
containers, builds, generated secrets and egress guard, and the same cold start (S1). Unit specs
prove each rule with the database, Redis and the buckets faked; this proves the rules still hold
with nothing faked.

```bash
npm run rehearse:adversarial
```

It needs what the operations rehearsal needs — Docker, both repositories side by side with
`npm ci` done — except the older release, which it never builds. About 25 minutes: four or five to
build, the rest to rehearse; most of the waiting is the scan re-queue sweep (once a minute) and an
alert tick.

Everything it touches is the operations rehearsal's, and is removed on exit in the same way. Every
person it makes is inserted in SQL with a password generated for the run, and every upload is
derived from the synthetic fixture export. The officer canary is made for each run and never
written to the results.

## What it rehearses

| Scenario                      | What it does                                                                                                                                                                                                                                                                                                                                                       | What must hold                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 People and places          | Makes a stranger, a follower (who follows through the API), four approved members of the fixture Fleet, an Officer, a Community Admin and the Owner of a second Community with a Fleet of its own. The site admin owns the fixture Community.                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                     |
| A2 Officer canary             | Checks, imports and reports on a fifteen-column export whose officer columns carry the canary, and checks a second whose officer tail is unreadable.                                                                                                                                                                                                               | The canary is in no database (a whole `pg_dumpall`, the worker's schema included), not in Redis (saved uncompressed), in no object in any bucket, in neither application's log and in no answer the API gave. The unreadable tail is refused. The public comment beside the officer columns reaches the roster.                                       |
| A3 Who may call what          | Eight routes — the roster, its history, the imports, the ranks report's CSV, the Fleet's chat channel, giving a role, Scan Diagnostics and the erasure list — for eight audiences: anonymous, stranger, follower, member, Officer, Community Admin, Owner and another Community's Owner. Then one Community's Fleet named under another's path, and a made-up one. | Each answers as the policy says; no refused answer, and no report an outsider can read, carries a name, a handle or a comment; giving a role is refused by a guard, before validation, to everybody without the capability. The forged paths are refused even to the other Community's Owner and the site admin. Every answer says `no-store`.        |
| A4 What the scanner is handed | With the worker stopped, uploads a roster and then swaps the bytes in the bucket; then, twice, puts something else where a roster was — a file carrying the test signature, then an archive — and, lifting the registry's write-once guard as only the database's owner could, a hash and a fresh scan request that agree with it.                                 | The swapped bytes are refused `HASH_MISMATCH`; the registry refuses the hash rewrite (`file_asset.sha256 is write-once`); the test signature is detected by the real clamd and refused `INFECTED`; the archive is refused `CONTENT_TYPE_MISMATCH` before any scan. Nothing is published unscanned.                                                    |
| A5 Order never matters        | Three exports — two members; a rise, a departure and a join; a rejoin, a contribution reset and a rank relabel — into seven new Fleets: in each of the six orders, one at a time, and all three at once.                                                                                                                                                           | Every Fleet's roster and history, read through the API, are the same once identifiers and timestamps of computation are set aside.                                                                                                                                                                                                                    |
| A6 Racing for the last place  | Makes a members' event with one place, and has four members answer Going at once.                                                                                                                                                                                                                                                                                  | One gets the place; three wait at positions 1, 2 and 3.                                                                                                                                                                                                                                                                                               |
| A7 Nothing comes back         | Erases a fixture member and imports an export naming them again; ages a chat message to 50 days and a roster file past its retention, and restarts the backend; marks a purge owed for 25 hours.                                                                                                                                                                   | After the erasure, and after the re-import and its replay, neither the name nor the handle is in any database or bucket, or in either application's log while serving. The message and the file are gone before the restarted backend serves, and the restore check's summary says so. `PURGE_OWED` opens and Scan Diagnostics counts the owed purge. |
| A8 Pictures at the door       | Pauses publication — a picture publishes to Cloudflare Images, which this stack cannot reach — and sends a file that is not a picture, and a PNG carrying an archive and the test signature, as profile pictures. Last, so the pause holds nothing else up.                                                                                                        | The first is refused at the door; the second is stored as pixels only, with neither the archive nor the signature in it. Nothing is published unscanned.                                                                                                                                                                                              |

The last line of the results says whether anything tried to reach Cloudflare; every attempted call
out of the machine is listed, and refused.

**Why a test signature and not EICAR.** An antivirus on the machine running the rehearsal can
intercept EICAR in its own localhost traffic — between MinIO and the worker, both on the host —
and the worker then cannot read the object at all (it answers `RETRY`, never clean). So
`run-rehearsal.sh` gives the rehearsal's clamd a signature of its own,
`FC043.Rehearsal.Marker`, for a marker made for the run, which nothing else knows. EICAR itself is
proved against a real clamd by the worker's `npm run rehearse:scan`.

## Results

As the operations rehearsal's: each check prints `PASS`, `FAIL` or `INFO` with its time, the table
is written as Markdown to `REHEARSAL_RESULTS`, and the logs beside it. The results are not
committed; [FC-043's acceptance evidence](../../docs/release/fc-043-acceptance.md) records a run.
