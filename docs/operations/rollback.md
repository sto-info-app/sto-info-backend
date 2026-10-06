# Rollback

What to do when a release goes wrong, and why rolling back is the last choice rather than the
first. The acceptance criterion this answers: a deploy rollback cannot restore an old upload
bypass. The detail of that defence is in
[Private image delivery](../image-delivery.md#rolling-back-the-application).

- [In order of preference](#in-order-of-preference)
- [Rolling back code](#rolling-back-code)
- [Reverting migrations](#reverting-migrations)
- [Retiring the old credentials at release](#retiring-the-old-credentials-at-release)

## In order of preference

1. **A switch.** Most problems can be stopped without a deploy, and every switch is reversible:
   - a feature switch — Fleet Communities, Custom Tracking or Storytime — on the Admin page's
     Features panel, with a reason (`PATCH /admin/feature-switches/:feature`). Every instance sees a
     change within the ten-second settings cache;
   - the publication pause, when what is wrong is what gets published
     ([Incidents](incidents.md#contain));
   - pausing an image estate run or a rescan campaign, each with a reason.

   No feature switch reaches the file gate: switching a feature off stops its pages and routes,
   and changes nothing about how uploads are scanned or published.

2. **Roll forward.** Fix the problem in a new release. This is the normal answer to a bad
   migration too: the FC-042 migrations refuse to revert, on purpose.
3. **Roll the code back**, within the rules below.
4. **Revert a migration** only where its `down` allows it, and never below
   `1797300000000-GuardPublishedImageReferences`.

## Rolling back code

Render's rollback redeploys an earlier build. `start:render` runs that build's `migration:run`
first; against a newer database it finds nothing to do, so the old build runs on today's schema.

1. **Never below the Fleet Community v1 release in production.** Every production release before
   it, including 1.4.23 (production on 30 September 2026), predates FC-012 and uploads pictures
   straight to Cloudflare Images or the public R2 bucket with no scan and no registry row. FC-012
   closed that path (`7b257d6c`…`da25348e`); a build without `da25348e` still has it.
2. **In other environments, never below FC-012**, and once the old credentials are retired, never
   below FC-042 either: an earlier build reads the old secret names and can publish nothing.
3. **Below FC-042** a build has no restore check, writes no hold or deny markers (the next FC-042
   boot backfills them), ignores the publication pause and cannot resume a paused queue. Resume
   publication before rolling back past it, and never restore a database under it.
4. **Below FC-040** nothing is signed, so no private picture shows. See
   [Private image delivery](../image-delivery.md#rolling-back-the-application) for when that is
   recoverable.
5. **The worker** rolls back the same way, by deploying an earlier image. Both sides must speak
   contract version 2. A worker from before FC-042 writes no heartbeat, so `WORKER_SILENT` opens and
   stays open, and it does not resend stranded verdicts.

### If an old build is deployed anyway

Two defences stop it reopening the bypass, and neither depends on anybody remembering the rules:

- **The database refuses the write.** Migration `1797300000000` puts a trigger on all 17 picture
  columns. A column takes a value only when a `file_asset` holds it as its `deliveryReference` and
  is `AVAILABLE` (or `UNVERIFIED`, for the legacy estate). Anything else raises SQLSTATE `IRG01`,
  "`<table>.<column>` may only hold a picture the asset registry has published", without the value.
  An old build never creates a `file_asset` row, so it cannot make its own upload pass.
- **Its credentials no longer work.** It reads `cloudflareImagesApiKey`, `cloudflareR2AccessKey` and
  `cloudflareR2Secret`, whose tokens are revoked at release, so its upload fails at Cloudflare
  before it reaches the database. That matters as well as the trigger, because an old build
  uploads before it writes the row. If the old keys have also been deleted from the secret, an old
  build does not start at all ("Missing Cloudflare R2 access key or secret").

So an old build starts, if its keys are there, and serves what needs no picture written; every
upload fails. `IRG01` in the log means somebody has deployed one: roll forward to a current build
at once.

## Reverting migrations

`npm run migration:revert` undoes the newest migration, one at a time. Three FC-042 migrations
refuse:

| Migration                                     | Its `down`                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1797500000000-AddOperationsAlerts`           | Refuses while publication is paused ("Publication is paused; resume it before rolling back"), because the code before it cannot resume the queue. It also refuses, before changing anything, once the Security Log holds any of its five actions ("… cannot be rolled back. Roll forward instead"), since removing them would lose Security Log history — and every view of Scan Diagnostics writes one |
| `1797300000000-GuardPublishedImageReferences` | **Always refuses**: removing the guard would let a build from before FC-012 publish unscanned pictures. Removing it deliberately is a reviewed migration of its own, never a revert                                                                                                                                                                                                                     |
| `1797200000000-RecordLedgerReconciliation`    | Refuses, changing nothing, once `LEDGERS_RECONCILED` is in the Security Log: removing the value would lose Security Log history, so roll forward instead                                                                                                                                                                                                                                                |

Because reverts go newest first, `1797300000000` is a floor: nothing at or below it can be reverted.
FC-040's migration sits under it, so it cannot be reverted either. The way back from a bad
migration is a new one that rolls forward.

The worker's `1797400000000-RecordWorkerHeartbeat` reverts cleanly: it drops the heartbeat table and
view, the backend's alerts then report the worker silent, and every worker writes its row again at
its next beat once the migration is re-applied.

## Retiring the old credentials at release

Steve's decisions of 30 September 2026: the Cloudflare Images token and the public R2 key pair move
to new secret names holding new tokens, and the old tokens are revoked, so a rolled-back build has
nothing that works. Production 1.4.23 reads the old names until the moment it is replaced, so the
order matters.

1. **Create the new tokens in Cloudflare** (Steve): an Images token that can publish, sign, list and
   delete pictures, and an R2 key pair for the public bucket that can read and delete objects.
2. **Add them to the production secret** under `cloudflareImagesGatedApiKey`,
   `cloudflareR2GatedAccessKey` and `cloudflareR2GatedSecret`, beside the old keys, which 1.4.23 is
   still reading. Add the other keys the release needs at the same time:
   `cloudflareR2ExportsAccessKey`, `cloudflareR2ExportsSecret`, `rosterErasureKey` and
   `cloudflareImagesSigningKey` ([Render services](render-services.md#secrets)).
3. **Deploy the release**: the backend, then the worker.
4. **Verify.** The backend starts (no `Missing Cloudflare secret keys` in its log); a picture
   uploads, is scanned and is published; a picture can be withdrawn; picture addresses are signed.
5. **Revoke the old tokens in Cloudflare.** Check first that nothing else uses them. From here, a
   build that reads the old names can upload nothing.
6. **Optionally, delete the old keys** — `cloudflareImagesApiKey`, `cloudflareR2AccessKey` and
   `cloudflareR2Secret` — from the secret. Steve's call: with them gone an old build does not start
   at all, which is louder; with them kept but revoked it starts and fails every upload.
7. **Record it**: when each token was created and revoked, and whether the old keys were deleted.
   Never the values.
