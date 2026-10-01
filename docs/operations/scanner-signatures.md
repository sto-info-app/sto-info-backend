# Scanner signatures

How the worker's ClamAV signatures are kept fresh, what happens when they are not, and what to do.
The policy is ADR-0005's decision 4: **an update failure must never cause files to be marked clean
using stale definitions.** The worker enforces it; nothing here can weaken it.

- [How they stay fresh](#how-they-stay-fresh)
- [The two thresholds](#the-two-thresholds)
- [When freshclam is failing](#when-freshclam-is-failing)
- [Reloads and memory](#reloads-and-memory)
- [Locally](#locally)

## How they stay fresh

- **Baked into the image.** The worker's `Dockerfile` runs `freshclam` during the build, so the
  image carries a signature database of about a gigabyte and `clamd` answers about seven seconds
  after the container starts. The database is as old as the build.
- **Updated in the container.** `freshclam` runs beside `clamd` under s6
  (`docker/s6-rc.d/freshclam`), in the foreground, logging to the container's output. It updates on
  start and then **twelve times a day** (`Checks 12` in `docker/freshclam.conf`), from
  `database.clamav.net`, with `ConnectTimeout 60`, `ReceiveTimeout 120` and `MaxAttempts 3`. If it
  exits, s6 starts it again.
- **`clamd` is told.** `NotifyClamd` makes `clamd` reload as soon as new signatures land, so the
  signature version the worker records on each attempt changes with the database rather than at the
  next restart.

## The two thresholds

| Age of the newest signatures | What happens                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Over **36 hours**            | `SIGNATURES_STALE` opens: every site admin is told, and Scan Diagnostics shows it. Nothing stops. (`SIGNATURES_STALE_HOURS` in the backend.)                                                                                                            |
| Over **48 hours**            | The worker pauses its queue with `SIGNATURES_TOO_OLD`, and `/health/ready` fails. Uploads wait in the queue; none is judged clean. After 10 minutes paused, `WORKER_PAUSED` opens too. (`CLAMAV_MAX_DEFINITION_AGE_HOURS`, set to 48 in `render.yaml`.) |

The age is worked out from when the signatures were built, as `clamd` reports it, not from when
they were downloaded. With twelve checks a day, twenty-four in a row have to fail before the worker
stops; the alert gives twelve hours to find out why.

## When freshclam is failing

`SIGNATURES_STALE` is open, or a worker is paused with `SIGNATURES_TOO_OLD`.

1. **Confirm it.** On Scan Diagnostics, the Worker panel shows each live process's signature
   version and age. Or read the heartbeat
   ([Readiness and heartbeats](readiness-and-heartbeats.md#reading-the-heartbeat)):
   `definitionsBuiltAt` is when the signatures were built.
2. **Read the worker's log on Render** for `freshclam`'s own lines, every two hours. They say
   whether the mirror refused, timed out or could not be resolved.
3. **If the mirror is refusing or unreachable, wait for the next check** while there is time
   before 48 hours. Each check tries three times.
4. **Restart the worker** if the log shows `freshclam` stuck or not running: it updates again on
   start. The worker pauses for a few seconds while `clamd` loads the image's database, and then
   again if that database is itself over 48 hours old, until `freshclam` succeeds.
5. **Rebuild the image** if the container cannot update at all and the deadline is close: a fresh
   build downloads a fresh database. On Render, deploy the worker again with the build cache
   cleared, so the download step is not reused from cache (the exact option is to confirm on
   Render, FC-052).
6. **Past 48 hours, let it stay paused.** That is the design: uploads wait, nothing is published
   unscanned, and everything waiting is scanned when the signatures are fresh. Do not raise
   `CLAMAV_MAX_DEFINITION_AGE_HOURS` to get round it.
7. **Mind the 24-hour sweep.** An upload whose placement has waited more than 24 hours is abandoned
   by the nightly clean-up (`StaleUploadSweepService`, `STALE_PLACEMENT_HOURS`), and the person has
   to upload it again. A pause that lasts into a second night costs people their uploads.
8. **Record it** as an incident ([Incidents](incidents.md#record)) if the worker paused.

## Reloads and memory

`ConcurrentDatabaseReload no` in `docker/clamd.conf`. With it, a reload replaces the database in
place: memory stays at about **1,068 MiB** through it, against 960 MiB idle, and scans wait while
it happens. With `yes`, `clamd` would hold both databases at once and peak at **2,022 MiB**, twelve
times a day, which a 2 GB plan cannot hold. The measurements are in ADR-0020 and the worker's
[infrastructure documentation](../../../sto-info-file-scan-worker/docs/infrastructure.md#sizing).

So a reload is a short pause, twelve times a day. The worker may report `SCANNER_UNREACHABLE` for
it, and jobs wait in the queue. That is expected; `WORKER_PAUSED` needs ten minutes paused before
it opens.

**Do not change `ConcurrentDatabaseReload` to `yes`** without moving to a plan with 4 GB.

## Locally

`stoi-clamav` (the public `clamav/clamav:stable` image, port 3310) runs its own `freshclam`. After a
cold start, the database it loads can be more than 48 hours old, and a local worker then pauses
with `SIGNATURES_TOO_OLD` until `clamd` reloads. To make it reload now, send `zRELOAD` followed by
a NUL byte to its socket. From Node:

```sh
node -e "const s=require('node:net').connect(3310,'127.0.0.1',()=>s.end('zRELOAD\0'));s.on('data',d=>process.stdout.write(d))"
```

`clamd` answers `RELOADING`. If its `freshclam` has already downloaded newer signatures, the
worker's next health poll, within 30 seconds, sees them and resumes.

`npm run rehearse:scan` in the worker repository includes a stale-signature scan and a scanner
restart mid-scan; see its [README](../../../sto-info-file-scan-worker/README.md#rehearsals).
