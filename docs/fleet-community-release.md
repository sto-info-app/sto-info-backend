# Fleet Community v1 — release checklist

What has to be true before Fleet Community goes out, in what order it goes out, when it is switched
on, and how to take it back. The detailed evidence behind each line is kept with the Fleet
Community plans, not in this repository.

## Who owns it

**Steve Roberts** owns every part of this release: the release itself, on-call, site
administration, the Render, AWS and Cloudflare accounts, and support.

Members get help in three ways:

- **Contact us**, with the topic **Fleet Communities**. The topic is offered only while Fleet
  Community is switched on.
- **Report**, on a member or on a chat message. Reports go straight to the site administrators'
  queues on the Admin page.
- **Help**, whose Fleet section and site administrators' guides cover every page.

## What ships

All of Fleet Community — Communities, Fleets and Armadas, roster imports and history, recruitment,
roles, holdings, news, events, activity, chat, moderation and the administrators' tools — as one
release, behind one switch that ships **off**. With it, and not behind any switch, come the
changes every upload goes through: the scan worker, quarantine, private picture delivery and
rescans.

No part of the agreed scope is held back for later.

## Before the release

- [ ] **The preflight passes against production**, with nothing found by any FAIL check:

  ```bash
  psql "<production connection>" -v schema=sto_info_app -f scripts/release-preflight/preflight.sql
  ```

  It is read-only and changes nothing. Note its INFO counts: they are what the release changes on
  purpose (below).
- [ ] **A fresh backup of the production database** is taken immediately before deploying, and
  its time noted. See [Restore](operations/restore.md).
- [ ] **The new secret keys are in production's secret**, beside the old ones, which the running
  release still reads. See [Rollback](operations/rollback.md#retiring-the-old-credentials-at-release)
  and [Render services](operations/render-services.md#secrets).
- [ ] **The worker's database role has its grant** on `sto_info_app.file_asset`. See
  [Render services](operations/render-services.md#deploy-order).
- [ ] **The rehearsals pass on this release's commit**: `npm run rehearse:release`,
  `rehearse:operations`, `rehearse:adversarial` and `rehearse:load`, and the frontend's Fleet
  journeys at desktop and phone widths.

## Releasing

1. **The backend.** It runs the release's migrations as it starts: all of them in one
   transaction, so a failure changes nothing. They rewrite the `account` and `character` tables
   once, briefly.
2. **Check Fleet Community is off**: Admin › Operations › Features shows Fleet Communities
   **Off**.
3. **The worker**, by hand, then check its heartbeat on Scan Diagnostics.
4. **The frontend.**
5. **Check uploads**: a picture uploads, is scanned and is published; a picture can be withdrawn;
   picture addresses are signed.
6. **Retire the old credentials**: revoke the old Cloudflare tokens. See
   [Rollback](operations/rollback.md#retiring-the-old-credentials-at-release).
7. **Check the site as members use it**: site news, signing in, an existing profile picture,
   Storytime and Custom Tracking as they were.

## What the release changes on purpose

Nothing a member made is deleted. These are the only changes to what existed before:

- **Two account preferences move** to their own table: privacy mode and the session timeout.
- **Days people typed become dates**: an STO account's and a Character's creation day lose a time
  of day they never had.
- **Every existing picture is registered** as an unverified legacy picture. It keeps showing,
  through a signed address, until a rescan clears it.
- **A Character's name stored as its picture is cleared.** Older Characters still name themselves
  as their picture, which has never shown.
- **Audit snapshots of news posts, contact requests and member reports keep identifiers only**,
  as the Privacy Policy now says.
- **Every member is told once** that the Privacy Policy and Terms of Use changed.
- **Fleet Community's switch is added, off**, and the publication pause is added, running.

## Switching Fleet Community on

Only when every line below is true. Each is a box to tick on the day, with when and how it was
checked:

- [ ] **Policies**: the Privacy Policy and Terms of Use describing Fleet Community are live (last
  updated 29 September 2026), and the notice has gone out.
- [ ] **Uploads**: every kind of upload has gone through the deployed worker and published, and a
  withdrawn picture can no longer be fetched by any old address.
- [ ] **Backup and restore**: a restore of a recent backup has been rehearsed on Render, with the
  restore check bringing back what the backup lacked.
- [ ] **Rollback**: switching off, and rolling the code forward, have been rehearsed on Render.
- [ ] **Operations**: no operations alert is open; Scan Diagnostics shows the worker `RUNNING`.
- [ ] **Support**: Contact us and both report queues work.

Then: **Admin › Operations › Features › Fleet Communities › Switch on**, with a reason. Every
server applies it within ten seconds, and the Security Log records it.

For the first days, watch Scan Diagnostics and its alerts, the report queues, and the Security Log.

## Taking it back

In this order, stopping at the first that is enough:

1. **Switch Fleet Community off** on the Admin page, with a reason. Everything it holds is kept,
   and switching it on again brings it all back. Uploads carry on being scanned and published.
2. **Pause publication** if what is wrong is what is being published.
3. **Roll forward**: fix it in a new release.

**Never roll production back to a release from before this one.** The earlier release cannot run
on this release's database: rehearsed, it served news but could not sign anybody in. The migrations
that matter refuse to revert. See [Rollback](operations/rollback.md).

## Known, and not part of the release

- **Armada structure overrides** were never agreed, so there are none; Armadas follow the game's
  structure.
- **One roster-parsing question is unmeasured**: whether a real public comment ever has a comma
  directly before a quote. Until it is measured, a row that could be read two ways is refused, not
  guessed at.
- **Some checks need the live services** and are done on the day: the worker on Render, the live
  Cloudflare account, chat across Render's instances, and the Render facts the runbooks mark "to
  confirm".
- **Three signed-in journeys are owed** on the Development environment, where their secrets exist:
  chat transcripts, roster erasure and private pictures. Each is built and covered by its own
  tests.
