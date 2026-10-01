# File assets: the registry, quarantine and delivery

Every file STO Info holds on somebody's behalf has a row in `file_asset`, and nothing is served
without consulting it. This document is the map: what the states mean, where bytes physically
live, **every** route by which a stored object can currently be fetched, and what withdrawing one
actually costs on each of those routes.

The inventory below is the part to read before changing anything about images. It exists because
protecting one R2 access path does not protect another, and the failure mode is silent: a boolean
flag in the database that leaves a CDN URL working looks exactly like a working revocation.

## The states

| State           | Meaning                                                                  | Served?                             |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| `UNVERIFIED`    | Bytes that predate the registry. No verdict of any kind exists for them. | By their existing public route only |
| `RECEIVING`     | The row exists; the bytes are still arriving.                            | No                                  |
| `QUARANTINED`   | The bytes are in the private bucket, waiting for a scanner.              | No                                  |
| `SCANNING`      | A scanner has the object and has not answered.                           | No                                  |
| `CLEAN`         | A scanner returned an affirmative clean verdict for exactly these bytes. | **No**                              |
| `AVAILABLE`     | Clean, processed, and published to an audience.                          | Yes                                 |
| `RETRY_PENDING` | A transient fault. Eligible to be scanned again.                         | No                                  |
| `REJECTED`      | Refused, and never published.                                            | No                                  |
| `REVOKED`       | Was `AVAILABLE`, and is not any more.                                    | No                                  |
| `DELETED`       | The object has been removed from storage. The row remains as evidence.   | No                                  |

`CLEAN` is deliberately not serveable. A scanner says something about bytes; it knows nothing
about whether the type is one the feature accepts, whether processing succeeded, or whether the
parent record still exists and still wants the file. Publication is a separate decision and a
separate call.

`UNVERIFIED` is neither a pass nor a failure. It is the honest record for objects uploaded through
the old synchronous scanner call, which returned nothing durable and looked at a buffer in memory
rather than at the object that ended up stored.

**They are still served, and FC-012 did not change that.** ADR-0015 expected FC-012 to gate them;
FC-012 found it could not, and [ADR-0021](../../../Plans/Fleets/ADR/0021-asynchronous-publication-and-placements.md)
records why: R26's rescans need a hash and a declared type that these rows do not have, so gating
them now would take every existing profile picture off the site with nothing able to clear it.
The count of `UNVERIFIED` rows is therefore the measure of how much of the estate is still
unproven, and it falls only as rescans clear it.

**FC-040 gates their delivery, and still does not call them clean.** Every published picture,
`UNVERIFIED` included, is copied to a private Cloudflare Images object that only a signed address
reaches, and the API signs one only while the asset may be shown. Steve's decision of 29 September
2026 keeps an `UNVERIFIED` picture on the site until FC-041 scans it. The copy records each
picture's SHA-256, size and type for that scan. See [Private image delivery](image-delivery.md).

**FC-041 scans them.** After release, a legacy rescan campaign stages a copy of every `UNVERIFIED`
published picture in quarantine and has the worker scan it like an upload. A clean picture becomes
`AVAILABLE`, an infected one is taken down, and one refused for policy keeps showing and is
reported to site admins. Site admins can rescan any selection of published pictures the same way.
See [Rescan campaigns](rescan-campaigns.md).

### Reaching `AVAILABLE`

Two doors, enforced by the `file_asset_guard` trigger rather than by service code:

- from `CLEAN` — a verdict followed by a publication decision;
- from `UNVERIFIED` — the backfill of bytes the site has been serving for years.

There is **no** path from `REJECTED` or `REVOKED`. Replacing a refused file means registering a
new asset, which gets its own verdict. The same trigger makes `objectKey`, `objectVersion` and
`sha256` write-once, so a verdict cannot be transferred to different bytes by editing the row.

## Where bytes live

| `storage`          | Location                                                          | Public? |
| ------------------ | ----------------------------------------------------------------- | ------- |
| `QUARANTINE`       | `CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME`, a separate private bucket | No      |
| `PUBLIC_IMAGES`    | Cloudflare Images                                                 | Yes     |
| `LEGACY_PUBLIC_R2` | `CLOUDFLARE_R2_BUCKET_NAME`, served through the CDN root          | Yes     |
| `NONE`             | The object is gone, or was never written                          | —       |

The quarantine bucket is **separate from the delivery bucket**, not a prefix inside it. The
delivery bucket is already reachable through `cdn.startrekonline.info`; a prefix within it would be
quarantined only for as long as nobody added a rule, a redirect or a Worker that reached the
prefix, and proving the absence of such a thing is a proof that has to be redone after every
configuration change. Which bucket an object is in is a property that cannot drift.

It has no public access, no custom domain, no `r2.dev` subdomain and no Cloudflare Images variant,
and **nothing in the codebase mints a presigned URL for it**. A signed URL is a bearer token with a
lifetime; a later quarantine cannot make one stop working. Bytes leave that bucket through the
authenticated delivery endpoint or not at all.

### One bucket, environment first in the key

Keys are `<env>/assets/<assetId>` — `prod/assets/…`, `dev/assets/…`, `local/assets/…` — matching
how the delivery bucket is already laid out. `QuarantineStorageService.buildObjectKey` is the only
place a key is constructed and it has to stay that way; see below for why.

Two consequences follow from what R2 actually offers, both checked against its documentation
rather than assumed:

- **A token cannot be scoped to a prefix, only to a bucket**
  ([Authentication](https://developers.cloudflare.com/r2/api/tokens/)). One bucket for every
  environment therefore means one credential reaches all of them. The delivery bucket already has
  this property and it does not matter there, because its contents are public. Here it does:
  quarantine holds unscanned files and roster CSVs full of other people's in-game identities. **Treat
  every quarantine credential as a production credential**, whichever environment it was issued for.
- **R2 has no bucket versioning.** `PutBucketVersioning` and `GetBucketVersioning` are unimplemented
  and `PutObject` returns no `VersionId`
  ([S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)), so
  `file_asset.objectVersion` is null for every object here. What binds a verdict to a particular set
  of bytes is therefore **the key never being reused**, plus the SHA-256. A quarantine key is derived
  from the asset's own UUID and every upload is a new asset, so no key is written twice; `objectKey`
  and `sha256` are both write-once at the database level. A caller that invented its own key scheme
  would break that silently, which is why one function owns key construction.

### Configuration

`CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME` is the **only** new environment variable. R2's S3 endpoint is
scoped to the account rather than to a bucket, so `CLOUDFLARE_R2_ENDPOINT` reaches this bucket too;
what separates the two buckets is the credentials, not the URL. A bucket created under a
[jurisdiction](https://developers.cloudflare.com/r2/reference/data-location/) is the exception —
it is reachable only through that jurisdiction's endpoint and cannot be moved afterwards — which is
one more reason to give quarantine the same jurisdiction as the delivery bucket.

The secrets are `cloudflareR2QuarantineAccessKey` and `cloudflareR2QuarantineSecret` in AWS Secrets
Manager, alongside the existing delivery-bucket pair.

### Bucket settings

What the bucket must be set to, and what it must be left alone. ADR-0017.

| Setting                           | Value                         | Why                                                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public Development URL (`r2.dev`) | **Disabled**                  | Off by default; carries AC2. Disabling asks you to type `disallow`                                                                                                                                                                  |
| Custom Domains                    | **None**                      | A custom domain is a public route. Do not connect one                                                                                                                                                                               |
| Cloudflare Images                 | **Not connected**             | Nothing here is delivered as an image                                                                                                                                                                                               |
| CORS policy                       | **None**                      | No browser fetches from this bucket; the backend streams it                                                                                                                                                                         |
| Storage class                     | **Standard**                  | Infrequent Access bills a 30-day minimum and charges for retrieval. Quarantine objects are read within minutes and many are then deleted, so IA costs more, not less                                                                |
| Location / jurisdiction           | **Match the delivery bucket** | Fixed at creation, unchangeable afterwards — the one irreversible choice. It also decides whether the existing `CLOUDFLARE_R2_ENDPOINT` reaches this bucket: a jurisdictional bucket is reachable only through its own endpoint     |
| Lifecycle rules                   | **Only the default**          | The default aborts incomplete multipart uploads after seven days, which is wanted. Add nothing else — see below                                                                                                                     |
| Bucket lock rules                 | **None**                      | See below                                                                                                                                                                                                                           |
| Event notifications               | **None**                      | See below                                                                                                                                                                                                                           |
| Data Access Logs                  | **Enabled**                   | Per-request records of who read which object, into Workers Observability. The audit trail R28 wants and the one W09's investigation route will be checked against. It records forward only, so enable it when the bucket is created |

Three of those are "leave it alone" for reasons worth stating, because each looks helpful:

- **No expiry lifecycle rule.** Retention is `file_asset.retainUntil` and FC-037's cron. A lifecycle
  rule would delete objects behind the registry's back, leaving rows that point at bytes which are
  gone — and the registry is the thing that is supposed to know what exists.
- **No bucket lock rule.** Locks override lifecycle rules, the strictest rule wins, and a bucket
  cannot be emptied while any lock exists. It would fight both the retention cron and any erasure
  request, which is the opposite of what R27 and R28 need.
- **No R2 event notifications.** The queue is BullMQ and the backend is what enqueues a scan
  (ADR-0006). An R2-to-Queues path would be a second way to start one that neither repository
  audits.

### Tokens

Two, both scoped to the quarantine bucket alone, and neither with an Admin permission:

| Holder  | Permission              | Reaches         |
| ------- | ----------------------- | --------------- |
| Backend | **Object Read & Write** | Quarantine only |
| Worker  | **Object Read only**    | Quarantine only |

Admin Read & Write would also allow creating and deleting buckets and editing bucket configuration,
including re-enabling public access. No application credential needs that.

Check the **existing delivery-bucket token** as well: if it holds an Admin permission, or is scoped
to all buckets rather than to the delivery bucket, then creating quarantine hands it access to
quarantine too, and the separation the bucket exists for is not there.

## The inventory of access paths

Ten ways a stored object can currently be fetched, and what it takes to stop each one.

**Since FC-040, paths 1 and 2 need a signature for every private picture**, and path 3 onwards
serves nothing once the R2 portraits are copied and the bucket's public access is closed. The
table below is what each path is, and what stops it; see
[Private image delivery](image-delivery.md) for the signing.

### Public, through Cloudflare Images

| #   | Path                           | Shape                                                         | Revoked by                                                                      |
| --- | ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Custom domain variant          | `<CDN_ROOT>/cdn-cgi/imagedelivery/<hash>/<imageId>/<variant>` | Deleting the image in Cloudflare Images, then purging the custom domain's cache |
| 2   | **`imagedelivery.net` direct** | `https://imagedelivery.net/<hash>/<imageId>/<variant>`        | The same delete. The custom domain's cache purge does **not** cover this host   |

Path 2 is the one to be careful about. `isValidCloudflareImageUrl` in
`src/shared/constants/image.constants.ts` accepts it as a supported form, so it is not
hypothetical: every Cloudflare Images object has a second public hostname that no purge of
`cdn.startrekonline.info` touches. Deleting the image is what kills both, which is why revocation
of a `PUBLIC_IMAGES` asset is a delete and not a cache operation.

**Variants.** Every one of these is a separate URL for the same object, and every one keeps working
until the image itself is deleted. **Twelve are configured on the account:**

`public`, `square40`, `square100`, `square200`, `square300`, `square512`, `banner1200x240`,
`banner2400x480`, `cover640x360`, `cover1920x1080`, `portrait133x200`, `portrait400x600`.

**The dashboard is the authority, not the code.** Only nine of those are referenced anywhere in
the backend and only two in the frontend; `square200` and `square512` are referenced by no code in
any repository. They are live public URLs for every image regardless — which is exactly what the
third acceptance criterion means by "variants". A variant nobody uses is still a way to fetch the
bytes, and adding one in the dashboard creates a route no code change records.

The probe's own list has to be kept in step with **R2 and Images → Images → Variants** by hand.
Discovering it automatically would need an authenticated Cloudflare API call, and the probe
deliberately sends no credential.

### Public, through R2 and the CDN root

| #   | Path               | Shape                                                                       | Revoked by                                                     |
| --- | ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 3   | Direct object      | `<CDN_ROOT>/<env>/<userId>[/<characterId>]/<filename>`                      | Deleting the object, then purging the cache                    |
| 4   | Image Resizing     | `<CDN_ROOT>/cdn-cgi/image/width=300,height=300,fit=cover,format=auto/<key>` | The same delete, plus a purge that covers the resized variants |
| 5   | `r2.dev` subdomain | `https://<bucket>.r2.dev/<key>`, **if enabled on the bucket**               | Disabling it, or deleting the object                           |

**Nothing writes to the public R2 bucket any more.** `uploadImageToCloudflareR2` and
`deleteImageFromCloudflareR2` on `ImageUploadsService` have no production callers — the only
reference to either is a spec. Every upload goes to Cloudflare Images via
`uploadImageToCloudflareImages`, whether it arrives through `ImageSlotService` (Storytime, Custom
Tracking) or directly from `UserService` and `CharacterService`. The `S3Client` provider in
`SharedModule` exists solely for those two dead methods.

Paths 3, 4 and 5 are therefore **read-only legacy**, reachable only by Character portraits stored
before Cloudflare Images. `character.entity.ts` has three getters that fall back to them when
`profilePictureId` contains a slash; `user_profile.entity.ts` has no such branch, so a profile
picture can only ever be an Images identifier. The backfill uses the same slash test the entity
does, so it agrees with whatever the data actually holds.

**Whether any such object still exists is a data question, not a code one:**

```sql
SELECT count(*) FROM sto_info_app."character" WHERE "profilePictureId" LIKE '%/%';
```

If that returns zero then nothing the application knows about is served from the public R2
bucket, the three legacy branches in `character.entity.ts` are unreachable, and the two dead
methods plus the `S3Client` provider can go. If it returns anything else, those portraits **are
being served right now** — the route works, as measured below — and FC-040 has real objects to
migrate rather than a vestigial code path to delete. Either way it is FC-012 and FC-040 work, not
FC-008's, and worth running before either is planned.

**Paths 3 and 4 are live.** Measured against production on 19 September 2026, with a canary object
really present in the delivery bucket:

| Request                                                               | Response           |
| --------------------------------------------------------------------- | ------------------ |
| `GET cdn.startrekonline.info/<a key really in the delivery bucket>`   | **`200`**          |
| `GET cdn.startrekonline.info/<a key really in the quarantine bucket>` | `404`              |
| `GET cdn.startrekonline.info/cdn-cgi/imagedelivery/…/<image>/public`  | `200`, `image/png` |

So **`cdn.startrekonline.info` is bound to the delivery R2 bucket as well as to Cloudflare
Images**, and the quarantine bucket is not reachable through it. That second line is real evidence
for the second acceptance criterion: the route demonstrably works, and it still will not serve a
quarantined object.

> **A warning for anybody re-testing this.** An earlier attempt concluded the opposite by reading
> response headers — a missing key returned `Content-Type: text/html` with no `cf-r2-request-id`,
> which looked like an ordinary zone 404 rather than R2. That inference was **wrong**. Cloudflare
> serves a generic 404 for a missing key on an R2 custom domain, so the absence of R2 headers
> proves nothing. The only reliable test is a key that is really there, which is exactly why the
> probe keeps a canary in the delivery bucket.

Path 4 cannot be tested directly with a text canary: Image Resizing refuses a non-image, and that
error is indistinguishable from the origin having refused. Its liveness follows from path 3 —
resizing fetches over the same origin, so if the direct object is served the resized one is too.

Path 5 is configuration rather than code: nothing in this repository builds an `r2.dev` URL, and
whether one works is a property of the bucket in the Cloudflare account.

### Authenticated

| #   | Path              | Shape                               | Revoked by                                          |
| --- | ----------------- | ----------------------------------- | --------------------------------------------------- |
| 6   | Delivery endpoint | `GET /file-assets/:assetId/content` | The database write. Immediate, for the next request |

The endpoint re-reads the row on every request and re-asks the audience question on every request.
Nothing is cached: the response carries `Cache-Control: no-store, private`, set in the controller
rather than left to a proxy whose configuration is not in this repository.

Every refusal is a 404 with the same body — for an asset that does not exist, one that was
refused, and one the reader simply may not see. Distinguishing them would let somebody enumerate
what is stored and, for a quarantined file, confirm that the scanner rejected it.

### Credentialled, not public

| #   | Path                         | Credential                                                         | Notes                                                                         |
| --- | ---------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 7   | R2 S3 API, delivery bucket   | `cloudflareR2GatedAccessKey` / `cloudflareR2GatedSecret`           | Writes public images                                                          |
| 8   | R2 S3 API, quarantine bucket | `cloudflareR2QuarantineAccessKey` / `cloudflareR2QuarantineSecret` | Reads and writes quarantine. **Must not** carry access to the delivery bucket |
| 9   | Cloudflare Images API        | `cloudflareImagesGatedApiKey`                                      | Uploads and deletes images                                                    |
| 10  | Worker's R2 client           | The worker's own credentials                                       | Reads quarantine to scan it. Least privilege: read only                       |

Separating 7 from 8 is the point of the separate bucket. The key that publishes must not be able to
read quarantine, and the key that reads quarantine must not be able to publish.

## Withdrawing an asset

`FileAssetService.revoke` writes the state first, because for a privately delivered asset that
write _is_ the whole revocation — the next request re-reads the row and gets nothing.

For an asset that was on a public route it is only the beginning. The service records
`purgeRequiredAt`, and `purgedAt` stays null until the object has actually been deleted and the
caches cleared. The two columns exist so the interval between them is visible: it is the window in
which the third acceptance criterion is not yet true of that asset, and a window nobody measures
is a window nobody notices growing. `IDX_file_asset_purge_outstanding` indexes exactly that
population, and it is normally empty.

Downloads already in somebody's possession cannot be recalled. What must hold is that no _new_
fetch succeeds.

### The asset-deny ledger (FC-042)

Steve's decisions of 30 September 2026. A restore from a backup taken before a withdrawal, a rescan
infection or a policy take-down would put the picture back. So every move of a `file_asset` into a
denied state — `REJECTED` (`FileAssetService.reject`), `REVOKED` (`revoke`, which every withdrawal,
rescan take-down and site admin take-down goes through) or `DELETED` (`discard`, which the
superseded-upload, stale-upload and roster import paths use) — is also written to a ledger outside
the database. The service checks the move against the state machine, writes the marker, and only
then writes the row. A move the state machine refuses writes nothing.

- **Where.** One object per move in the private quarantine bucket:
  `<NODE_ENV>/asset-deny-ledger/<createdAt>_<assetId>_<REJECTED|REVOKED|DELETED>.json`, so the
  boot check can compare it with the database from the keys alone.
- **What.** `{ assetId, state, deliveryReference, storage, createdAt }`, with `storage` as it was
  before the move. No reason, name or owner. The restore check adds `purgedAt` when it deletes the
  delivered object of an asset the database does not have.
- **Brought back.** At every boot, the restore check (see
  [Privacy: erasure](privacy-erasure.md#the-restore-check-fc-042)) takes each asset's latest marker
  and, when the database does not already have the asset denied:
  - **Still served** (`AVAILABLE` or `UNVERIFIED`): withdraws it as a site admin's withdrawal would
    — its placement settled `WITHDRAWN`, the row `REVOKED` and the Cloudflare delete tried again,
    through `AssetWithdrawalService`; one with no delivery reference is revoked directly.
  - **Not yet served** (being received, scanned or published): settles its placement `WITHDRAWN`
    and refuses it (`REJECTED`, code `RESTORED_FROM_LEDGER`) when the marker says it was refused,
    or discards it (`DELETED`) otherwise. `REVOKED` cannot be reached from those states, so it fails
    closed to `DELETED` rather than leaving an asset that could still be published.
  - **Unknown to the database**, as one uploaded after the backup was taken: deletes the delivered
    object the marker names, if any — from Cloudflare Images, or from R2 for a legacy object — and
    counts a missing object as deleted. A Cloudflare failure is logged and tried again at the next
    boot; it does not stop the API starting, since nothing in the database can serve the asset.
  The reason on each is "Brought back from the asset-deny ledger after a restore."
- **Triggers.** `file_asset_guard` lets every one of these moves through: it guards only the
  object's identity and the two ways into `AVAILABLE`.
- **Failures.** If the ledger cannot be written, the move fails and the row is unchanged. A marker
  whose database write then failed is denied again at the next boot: the ledger fails closed.
- **Not yet.** The record that pointed at a picture withdrawn this way keeps its delivery
  reference until somebody replaces it. Nothing is served from it — the Cloudflare object is
  deleted, and the delivery endpoint refuses a revoked row — so it shows as a missing picture.

## Evidencing the two infrastructure criteria

Two of FC-008's acceptance criteria are claims about a live Cloudflare account, and no code in this
repository can establish them. `scripts/asset-delivery-probe` attempts every public path above
against a known quarantined object and asserts that each one is refused. Run it against a real
environment:

```bash
npm run probe:asset-delivery
```

It makes no authenticated request and writes nothing. See that directory's README for what each
check means and what a failure implies.

Until that output exists for an environment, the claim "quarantine has no public route" is a
design intention rather than a verified property of that environment.

### What the probe cannot establish

It prints this itself at the end of every completed run, because a screen of `PASS` lines invites
the conclusion that the criterion is met:

1. **The quarantine bucket has no custom domain.** Every request the probe makes goes to the
   _delivery_ hostname. A custom domain bound to the quarantine bucket would be at an address
   nobody has told the probe about, and an unknown hostname cannot be probed. Its absence is read
   from **R2 → the bucket → Settings → Custom Domains**, and there is no other way to establish it.
2. **The Public Development URL is disabled.** Cloudflare answers `500` on an `r2.dev` hostname
   both for a bucket that does not exist and, as far as can be told, for one whose public access is
   switched off, so the status cannot separate the two.
3. **The probed object exists.** A key that was never written 404s from everywhere, which looks
   exactly like a pass.

### The two canary objects — do not delete them

| Bucket            | Key                              |
| ----------------- | -------------------------------- |
| `stoi-quarantine` | `334843800-example-file-q.txt`   |
| `stoi-uploads`    | `334843800-example-file-cdn.txt` |

Both sit at the bucket root and exist for nothing but the delivery probe.

The quarantine one is the subject of the test. The delivery one is a **second positive control**:
the image control proves the probe can reach Cloudflare Images and says nothing about whether it
could detect a publicly served R2 object — and a refusal from a route that does not work anyway
is not evidence of anything. Its answer is not pass or fail; it reports whether the custom domain
reaches R2 at all, and the run prints the interpretation.

Neither is a registered asset. There is no `file_asset` row for either, so the retention cron
leaves both alone — and equally, nothing in the application will recreate one if it is removed.
Their contents are arbitrary and explain nothing about themselves; **this section and the probe's
own output are the explanation**.

**If either is deleted the probe keeps reporting `PASS`**, because a key that was never written
404s from everywhere and that is indistinguishable from a closed route. The probe cannot detect
the difference — it would need a credential, and it sends none — so it names both bucket and key
in the residual checks it prints at the end of every run.

So AC2 is part probe and part dashboard, and the split is worth stating plainly: the probe covers
the Images variants, both Images hostnames, the delivery domain and the `r2.dev` hostnames it can
name. It does not cover a custom domain on the quarantine bucket, and it never will.

## Audiences

| Audience        | Who                                                | Resolved by            |
| --------------- | -------------------------------------------------- | ---------------------- |
| `PUBLIC`        | Anyone, signed in or not                           | The endpoint           |
| `AUTHENTICATED` | Any signed-in reader                               | The endpoint           |
| `OWNER`         | The uploading user alone                           | The endpoint           |
| `SCOPE`         | Whoever the owning Community, Fleet or Armada says | `FleetAudienceService` |
| `RESTRICTED`    | Nobody, through any ordinary route                 | Refused outright       |

A `SCOPE` asset names exactly one scope and one of the four `FleetAudience` values, and the
question is delegated to FC-005's existing service. "May this person see this" already has one
implementation in this codebase and a file is not a reason to write a second that will drift.

`RESTRICTED` is what a retained roster import source is. It is evidence, not content: it exists so
an authorised investigator can be shown why an import produced what it did, and that route is
W09's to build with its own authority and its own reason logging. Until then the delivery endpoint
refuses it to every caller, including the person who uploaded it.

## Adding a new kind of upload later

Document uploads are a likely future feature, and Cloudflare Images cannot serve a PDF, so the
public R2 bucket is kept for that rather than retired. This section is about how such an upload
should reach it.

### Do not reuse `ImageUploadsService.uploadImageToCloudflareR2`

It is dead code — no callers — and it looks like exactly the right starting point. It is not, for
four reasons. The second is a security defect rather than a matter of taste:

1. **It is bound to the delivery bucket.** It injects the shared `S3Client`, built with the
   delivery endpoint and the publishing credentials, and reads `CLOUDFLARE_R2_BUCKET_NAME`. Making
   it take either bucket would produce one service that is a single wrong argument away from
   writing a quarantined file into the public bucket — which is the thing the two-credential split
   in ADR-0016 exists to prevent.
2. **It builds the key from the uploaded filename**: `${env}/${userId}/${safeFileName}`. R2 has no
   object versioning (ADR-0017), so a reusable key means the same key can be written twice —
   uploading `roster.csv` a second time overwrites the first and silently transfers its clean
   verdict onto bytes nobody scanned. That is the failure the fourth acceptance criterion exists to
   forbid. **A quarantine key must be derived from the asset's UUID**, which is why
   `QuarantineStorageService.buildObjectKey` is the only place one is constructed.
3. **It gates on being an image.** `validateAndSanitiseFile` checks image MIME types and
   dimensions before storing. Quarantine works the other way round on purpose: the bytes are stored
   privately first and inspected afterwards, because inspecting an unscanned file is itself a risk
   and because a rejected file still needs a record.
4. **It stores the browser's claimed content type.** `QuarantineStorageService.put` deliberately
   writes everything as `application/octet-stream`, so no later delivery path can be tempted to
   trust a type that arrived from outside.

### What to do instead

The registry already is the shape a document upload wants. A new kind of upload is:

1. `FileAssetService.register` with a new `FileAssetKind`, the right `FileAssetAudience` and, if the
   retention policy gives it one, a `retainUntil`.
2. `QuarantineStorageService.put` under the key `buildObjectKey` returns, then
   `FileAssetService.recordStored` with the hash.
3. The scan, then `recordCleanVerdict` — or `reject`, which tells the uploader nothing beyond the
   single word `GET /file-assets/:assetId/status` answers with.
4. `FileAssetService.publish`, with the `FileAssetStorage` the audience calls for.

Step 4 is the only one that needs new work for a public document. A restricted document needs
nothing at all — it stays in quarantine and is served by `GET /file-assets/:assetId/content`, which
already streams arbitrary bytes and already sets `Content-Disposition: attachment`.

A **public** document needs a new `FileAssetStorage` value — call it `PUBLIC_R2`, alongside the
existing `LEGACY_PUBLIC_R2` — plus a copy from quarantine into the public bucket at publication, and
a delete-and-purge on revocation. Deliberately not built now: a storage value with no writer is a
value a future author has to guess the meaning of, and the audience question for documents has not
been asked yet.

`ImageUploadsService`'s two R2 methods can stay where they are meanwhile. They cost an `S3Client`
built at startup and nothing else, and they are a working reference for the S3 call shapes.

## How an asset gets scanned

FC-010 joined the two halves. The path is a queue in each direction, and neither side can act on
its own messages — [ADR-0015](../../../Plans/Fleets/ADR/0015-asset-registry-ownership.md)'s
authority boundary expressed as an absence rather than as a check.

| Step | Who | What |
| --- | --- | --- |
| 1 | backend | `recordStored` puts the asset in `QUARANTINED` with its key and hash. |
| 2 | backend | `ScanRequestProducerService.requestScan` moves it to `SCANNING` and puts a message on `file-scan`. |
| 3 | worker | Reads the object, scans it, writes an attempt row, puts a verdict on `file-scan-verdict`. |
| 4 | backend | `ScanVerdictService.apply` rechecks the hash and calls `recordCleanVerdict`, `reject` or `markRetryPending`. |
| 5 | backend | A clean verdict enqueues publication; `AssetPublicationService` publishes against a fresh look at the registry. **Not step 4.** |

Three things about step 2 and step 4 are worth knowing before changing either.

**The asset moves to `SCANNING` before the message is sent.** A second request for the same asset
then fails the state check instead of queueing a duplicate, and an asset stuck in `SCANNING` is a
visible symptom of a queue that is not moving. If the send then fails the asset is put back to
`RETRY_PENDING`, because an asset left in `SCANNING` with nothing scanning it is the one outcome
nobody would notice.

**The verdict is rechecked against the registry, not trusted.** ADR-0006 required publication to be
performed "against current permissions with a hash recheck". `ScanVerdictService` refuses a verdict
whose object key, object version or expected hash no longer match the row, which is the case where
an asset was replaced while the scanner was working — the answer belongs to a file that no longer
exists.

**A clean verdict reaches `CLEAN` and stops.** Publication additionally needs an allowed type,
successful processing and an audience, and a scanner knows none of those. Since FC-012 the
verdict processor enqueues a publication job at that point — an asset identifier and nothing
else — and everything after it is decided against the registry when the job runs.

### The declared type travels with the request

Contract version 2 carries `declaredContentType`, and the worker refuses an object whose bytes
contradict it —
[ADR-0020](../../../Plans/Fleets/ADR/0020-scanner-health-and-declared-types.md). Three
consequences land on this side of the queue.

**`declaredContentType` is normalised where it is written.** `FileAssetService.register` puts
every value through `normaliseMediaType`, so `image/jpg` and `image/jpeg` are one string by the
time a scanner compares it with anything, and `application/vnd.ms-excel` — what a Windows
machine with Excel installed calls a `.csv` — is `text/csv`. A migration rewrote the rows
already there. A claim that is not a media type at all becomes null, which is what the column
already means by "nobody said".

**An asset with no declared type is not queued.** `requestScan` refuses it rather than sending a
message the check cannot apply to. The legacy estate is unaffected in practice: those rows have
no hash either, and that refusal comes first.

**A roster import declares `text/csv` whatever the browser said**, because the asset it
registers is the sanitised CSV this application wrote and not the file that arrived. The
uploader's own claim is kept on the provenance record instead, where "what was actually
uploaded" already lives.

The message shapes, the versioning and the recovery path after a Redis loss are in the worker's
[queues documentation](../../sto-info-file-scan-worker/docs/queues.md); the contract file itself is
duplicated byte for byte in both repositories and held together by a digest.

### Watching the scanner: `GET /admin/file-scanning/diagnostics`

FC-003 asked for usage figures that tell initial scans, re-scans, retries, latency and backlog
apart. This administrator-only route reads each of its sources on its own, and a part is `null`
when its source cannot be reached. That way the page still shows the rest while something is down,
which is when it is most needed.

| Part | Source |
| --- | --- |
| `usage` | The worker's `scan_usage` view: one entry each for 24 hours, 7 days and 30 days. |
| `engine` | The worker's `scan_engine_status` view, plus the signature age worked out here. |
| `queue` | The `file-scan` queue's own job counts, prioritised jobs counted as waiting. |
| `awaiting` | The registry's assets in `QUARANTINED`, `SCANNING` and `RETRY_PENDING`. |
| `workers` | The worker's `worker_heartbeat_status` view (FC-042): one entry per worker process, latest beat first, with `live`, `secondsSinceBeat`, `pausedMinutes` and `signatureAgeHours` worked out by the database against its own clock. `null` when the view cannot be read. |
| `alerts` | The operations alerts open now (FC-042), oldest first. |
| `publication` | The publication pause (FC-042): whether it is on, since when and by whom (`pausedByUserId`, and `pausedByUsername`, null for an account since gone), whether the queue itself is paused, and how many cleared uploads are held. |

**Every read is logged** (FC-042, Steve's decision of 30 September 2026). The diagnostics stay
ADMIN-only, and each page view writes one `SCAN_DIAGNOSTICS_VIEWED` entry to the site admin log —
see [Admin audit](admin-audit.md#operations-fc-042). The Scan Diagnostics page does not poll: it
reads this route, the first page of refusals and the first page of every queue's failed jobs when
it opens and on Refresh. So this route logs each read, and the other two log only a deliberate
read — a later page, or for the failed jobs one queue chosen; their first page is covered by the
diagnostics entry it is read with. One asset's outcome logs its own read.

**This application cannot read the worker's attempt table, and does not need to.** The worker's
migration `1794800000000-RecordScanUsage` grants the two views, which carry totals only, to the
role named by the worker's `BACKEND_DB_ROLE`. Nothing in the answer names an asset, a file, an
owner or a signature. The definitions of re-scan, retry, scan time and wait are in the worker's
[database documentation](../../sto-info-file-scan-worker/docs/database.md).

### Why an upload was refused (FC-039)

`GET /admin/file-scanning/rejections?page=` lists the assets a scanner or policy refused, newest
verdict first, 25 to a page, and `GET /admin/file-scanning/assets/:assetId` reads one asset's
outcome. Both are administrator-only and answer the same shape: the asset's kind and state, its
rejection code, the engine, engine version, signature version and policy version behind the
verdict, and when it was uploaded and judged. Never a signature name, which is not recorded, and
nothing else about the asset. See [Admin audit](admin-audit.md#why-an-upload-was-refused).

## Running the pipeline (FC-042)

Steve's decisions of 30 September 2026: every site admin is told in-app when the file pipeline
needs a person, once per problem until it clears; a site admin can retry a failed job, with a
reason; and publication can be paused without stopping uploads. The runbooks that use these are
in [`docs/operations/`](operations/).

### Alerts

`OperationsAlertService` runs every minute (`@Cron`, UTC). It first brings the publication queue
into line with the pause switch, then checks for each of these, with thresholds fixed in code in
`src/operations/alerts/operations-alert.constants.ts`:

| Alert | Opens when | Detail |
| --- | --- | --- |
| `SCAN_QUEUE_LAG` | The oldest waiting (waiting or prioritised) job on `file-scan` was queued more than 15 minutes ago. | `oldestMinutes` |
| `PUBLICATION_QUEUE_LAG` | The same on `file-asset-publication` — never while publication is paused, when it clears. | `oldestMinutes` |
| `WORKER_SILENT` | No worker has beaten in the last 2 minutes, or the heartbeat view cannot be read. | `liveWorkers`, `minutesSinceBeat` |
| `WORKER_PAUSED` | Every live worker is `PAUSED`, and the most recent pause began 10 minutes ago or more. | `pausedWorkers`, `pausedMinutes` |
| `SIGNATURES_STALE` | The newest signatures any live worker holds were built more than 36 hours ago (the worker stops at 48). | `signatureAgeHours` |
| `FAILED_JOBS` | Any job is in the failed set of a queue below. | `failed` |
| `PUBLICATION_PAUSED_LONG` | Publication has been paused for more than an hour. | `pausedMinutes` |
| `QUEUES_UNREACHABLE` | Redis has not answered the alert run for 2 minutes running (counted in memory from the first run that could not reach it; a restart starts again). | `minutesUnreachable` |

- **One alert per problem until it clears.** Each occurrence is a row in `operations_alert`
  (`openedAt`, `lastSeenAt`, `clearedAt`, all `timestamptz`), and a partial unique index keeps one
  of each kind open. When a problem opens, every site admin (role `ADMIN`, not disabled) gets one
  `WARNING` notification linking to Scan Diagnostics; while it stays open the run only moves
  `lastSeenAt` and the counts; when it goes, `clearedAt` is set and each gets one `INFO`
  notification. A problem that comes back is a new row.
- **Counts only.** The detail is minutes, hours and counts, and a CHECK refuses anything but
  numbers in it: never a file name, a user or an error's text.
- **Redis is asked first.** Each run asks Redis a one-field question through the scan queue's
  connection and gives up after 5 seconds, because a client with nothing to talk to holds commands
  rather than failing them (BullMQ's `maxRetriesPerRequest: null`). Every other Redis read on the
  diagnostics side has the same limit (`redisWithin()` in `src/shared/queue/`): the diagnostics'
  queue counts and the publication status come back `null`, the failed-jobs list and its actions
  answer 503, and a pause or resume is written to the switch and answered with `queuePaused` null. When it does not answer, the queue lag and failed-job checks are not
  run and their alerts stay as they were, and the pause is not re-applied until it answers.
- **A check that cannot tell changes nothing.** Redis down leaves the queue alerts as they were;
  a heartbeat view that cannot be read opens `WORKER_SILENT` and says nothing about the other two
  worker alerts; with no live worker at all, only `WORKER_SILENT` is judged.
- **Ages are measured on the right clock.** Queue waits compare BullMQ's `timestamp` (this
  application's clock, which queued the job) with this application's clock; heartbeat ages are
  worked out by PostgreSQL against `now()`, the clock the worker wrote them on.
- **Runs do not overlap.** A run still going when the next is due is skipped, and a PostgreSQL
  advisory lock (`1797500000`) keeps two instances from running at once.

### Failed jobs

`GET /admin/file-scanning/failed-jobs?queue=&page=` lists the jobs a queue gave up on, queue by
queue and newest failure first, 25 to a page: the queue, job ID, job name, attempts made, when it
failed, the asset, transcript or Fleet ID from its data, and the failure **reduced to a code** — a
network error's code (`ECONNREFUSED`), `HTTP_<status>`, `TIMEOUT`, `STALLED`, or the thrown error's
class name. Never the job's data or the error's text, which can quote a statement's values or a
host. Each item also says whether a retry could help (`retryable`, `notRetryableBecause`).

`POST /admin/file-scanning/failed-jobs/:queue/:jobId/retry` and
`POST /admin/file-scanning/failed-jobs/retry-all` (optional `queue`) each take a reason and write
a `SCAN_JOB_RETRIED` entry to the site admin log. A retried job gets its attempts back. "Retry all"
looks at up to 500 failed jobs a press, retries those a retry can help, leaves the rest, and logs
one entry with the counts.

`POST /admin/file-scanning/failed-jobs/:queue/:jobId/discard` and
`POST /admin/file-scanning/failed-jobs/discard-unretryable` (optional `queue`) each take a reason,
remove failed jobs from BullMQ, and write a `SCAN_JOB_DISCARDED` entry (Steve's decision of 30
September 2026). A single discard removes any failed job, whether or not a retry could help it;
"Discard unretryable" removes only those the check below says a retry cannot help, up to 500 a
press, and logs one entry with the counts. `retryable` on each listed job tells the page which to
offer. `FAILED_JOBS` counts every failed job, so it clears once each has been retried or discarded.

**A retry is only sent when it can change something.** Every job is read against its record when
it runs, so one whose record has moved on would do nothing; retrying it is refused with a 409 that
says why, and "Retry all" skips it:

| Queue | Kept on failure | A retry is allowed while |
| --- | --- | --- |
| `file-scan` | yes | an upload's asset is still `SCANNING` the same object; a rescan's (`rescan_<id>`) rescan is still `REQUESTED`. The worker is idempotent: a finished attempt repeats its verdict, and a spent retry budget answers `RETRY_BUDGET_EXHAUSTED`, so a retry always ends in a verdict. An asset that has since been refused, published or swept cannot move again (`REJECTED` only goes to `DELETED`), so its retry is refused. |
| `file-scan-verdict` | yes | the same: the rescan it answers (found by its staged copy) is still `REQUESTED`, or else the upload is still `SCANNING` the same object. |
| `file-asset-publication` | yes | the asset is `CLEAN` or `AVAILABLE` and its placement still `PENDING`, or `CLEAN` with a `HELD` placement (the owning feature is asked again). While publication is paused, a retried job waits with the rest. |
| `chat-transcript` | yes | the transcript is still `PENDING`; the retention sweep gives up on one after an hour. |
| `fleet-roster-replay` | yes | the Fleet's projection is behind (`built < requested`); the ten-minute sweep queues a fresh replay anyway. |
| `image-estate` | **no** (`removeOnFail: true`) | not listed: each run records its own failures and is resumed from its page. |
| `file-rescan` | **no** (`removeOnFail: true`) | not listed: a campaign's batch that fails is resumed with the campaign. |

The queues are found through the module graph rather than registered again, so the list opens no
Redis connections of its own.

**A job identifier never strands work.** BullMQ ignores an `add` whose `jobId` is already in the
queue in any state, and a kept failed job used to swallow every later request for the same work.
`AssetPublicationQueueService.enqueue`, the only producer of `file-asset-publication`, keys by
asset, so an asset whose publication had failed could never be queued again — a held roster file
queued once decided, say. It now sends the failed job round again instead, with its attempts
back, and logs `[enqueue] Failed publication sent round again - AssetId: …`
(`reviveFailedJob()` in `src/shared/queue/`). The other kept queues need no change:

| Queue | Job ID | Why no fix |
| --- | --- | --- |
| `chat-transcript` | BullMQ's own | Every request is a new job. |
| `fleet-roster-replay` | BullMQ's own | Every request is a new job. |
| `file-scan` | `<assetId>_<policyVersion>`, or `rescan_<rescanId>` | A request is only made for a new asset or a new rescan, so the identifier is never reused. |
| `file-scan-verdict` | The worker's attempt ID and the time of its answer (`<attemptId>_<scannedAt ms>`), so a reopened attempt's new answer is a new job | Produced by the worker, not here: see its [queues documentation](../../sto-info-file-scan-worker/docs/queues.md). |

### Pausing publication

A kill switch for everything a scanner clears: while it is on, uploads are still accepted and
scanned, and nothing is published; when it is turned off, everything held publishes.

- **One path.** Publication only happens in `AssetPublicationProcessor`, on
  `file-asset-publication`. Pictures, restricted roster files (roster imports and their
  corrections) and every clean verdict reach it through `AssetPublicationQueueService`; the image
  estate's copies move pictures already published and are not publication. Pausing that queue
  pauses exactly publication.
- **The database is the authority.** The switch is the `app_setting` `FILE_PUBLICATION_PAUSED`: one
  JSON value, `{"paused":false}` or `{"paused":true,"pausedAt":"…","pausedByUserId":"…"}`, so the
  switch and who threw it when are always written and read together (the table's own `updatedAt`
  is a zoneless timestamp). Seeded running by migration `1797500000000`. A value that cannot be
  read counts as paused.
- **Applied three ways.** `queue.pause()` or `queue.resume()` at once; again at startup; and again
  at every minute's alert run, reading the switch afresh past the 10-second settings cache, because
  a new Redis knows nothing of a pause. And the processor asks the switch before each job: a job
  that reaches it while the switch is on re-applies the pause and puts itself back for a minute,
  unharmed. A job already running when publication is paused finishes.
- **Resumed when.** Resuming writes `{"paused":false,"resumedAt":"…"}`; the stale-upload sweep
  counts its day from there.
- **ADMIN only, with a reason.** `GET /admin/file-publication`, `POST /admin/file-publication/pause`
  and `/resume`, logged as `PUBLICATION_PAUSED` and `PUBLICATION_RESUMED` in the same transaction as
  the switch. Pausing a paused switch, or resuming a running one, is a 409.
- **Independent of every feature switch**, like the file gate itself.
- **Rolling back.** Migration `1797500000000`'s `down` refuses while publication is paused, since
  the code before it cannot resume the queue, and once the Security Log holds any of its five
  actions, since removing them would lose its history: roll forward instead. Nothing is deleted.

## Uploading a picture, since FC-012

Every picture the site accepts — a profile picture, a Character portrait, seven kinds of
Storytime artwork and a Custom Tracking answer — goes through one path, and nothing reaches
Cloudflare Images until a scanner has cleared it.
[ADR-0021](../../../Plans/Fleets/ADR/0021-asynchronous-publication-and-placements.md) is the
decision; this is the shape of it.

| Step | Who | What |
| --- | --- | --- |
| 1 | the feature | Applies its slot's rules and calls `ImageIngressService.accept`. |
| 2 | `ImageSlotService` | Reads the encoding out of the bytes. A PNG that is not a PNG stops here. |
| 2a | `ImageReencodeService` | Decodes the picture and writes it out again (FC-043): only pixels go on. |
| 3 | `AssetIngressService` | Registers, quarantines, claims the slot, requests the scan. |
| 4 | the worker | Scans, and puts a verdict on `file-scan-verdict`. |
| 5 | `ScanVerdictProcessor` | Applies the verdict and, for a clean one, enqueues publication. |
| 6 | `AssetPublicationService` | Pushes to Cloudflare Images, publishes the asset, tells the feature, withdraws what it replaced, drops the quarantined copy. |

**Only pixels are quarantined (FC-043).** `clamd` reads an archive member only up to
`MaxFileSize` and reports nothing about the rest, so a small PNG carrying an archive — still a
PNG to every header check — could hide a payload past that point and come back clean; the worker's
scan rehearsal shows it. Step 2a closes it before the scanner: sharp decodes every picture and
writes it out again in the same encoding, so appended bytes, archives in ancillary chunks or APP
segments, comments and every kind of metadata are gone before anything is hashed, stored, scanned
or published. With Steve's choices of 1 October 2026, the orientation a camera recorded is applied
first so a phone photograph is not published on its side; then all metadata goes, the location
included; PNG stays lossless and JPEG is written at quality 90 with mozjpeg; and a picture of more
than 50 megapixels (`IMAGE_MAX_PIXELS`) is refused before it is decoded, as "too large to
process". A picture sharp cannot decode is refused as "not a readable PNG or JPEG image".
`test/asset-upload-matrix.spec.ts` drives every caller through it with real pictures, and checks
that what is quarantined carries nothing that was appended.

**The owning feature's row is not written until step 6.** That is the third acceptance
criterion: whatever picture a record shows goes on being shown until the replacement has been
cleared, so a refused upload costs its uploader nothing.

**The order inside step 6 is the guarantee, and it is not arbitrary.** Cloudflare first, so a
failure leaves the asset `CLEAN` and retryable. The registry before the feature's row, so no
reference ever points at bytes the registry has not published. The previous picture last, so a
replacement that goes wrong leaves it in place.

### What a placement is

`file_asset_placement` says which record and which slot a picture is for — the registry itself
knows only the kind, the owner and the scope. At most one `PENDING` and one `ACTIVE` row exist
per slot, enforced by partial unique indexes, which is also what makes a second upload supersede
the first rather than race it.

A placement carries the small amount a publisher needs and cannot work out for itself:
Cloudflare's own tag and identifier, and Custom Tracking's alt text, whose row does not exist
until the picture is published.

### Adding a picture to a new feature

Three things, and the first of them is the one that fails loudly if you forget it:

1. **Register a publisher** for the subject, implementing `AssetPublisher`. Without one, ingress
   refuses the upload — deliberately, because the alternative is an asset stuck at `CLEAN` an
   hour later with nothing to say why.
2. **Add the subject** to `FileAssetSubject`, and a slot to `FileAssetSlot` if none of the seven
   fits.
3. **Call `ImageIngressService.accept`** from the feature, with the slot's specification. Do not
   call `ImageUploadsService` directly: it no longer scans anything, and a route that reaches it
   without going through ingress is the bypass R24 forbids.

The same bypass is what a build from before FC-012 still has, and a Render rollback would bring it
back. So the database refuses it too (FC-042): a trigger on every picture column lets the column
take a value only when a `file_asset` holds it as its `deliveryReference` and is `AVAILABLE` or
`UNVERIFIED`. NULL, and an update that leaves the value as it was, always pass. A refusal raises
SQLSTATE `IRG01` and names the table and column. A new picture column needs its own trigger in a
new migration: the guard migration's spec fails until `IMAGE_REFERENCE_COLUMNS` and the guarded
columns match. See [Private image delivery](image-delivery.md#rolling-back-the-application).

### `deliveryReference`, and why it is not `objectKey`

`objectKey` is write-once, and for anything this application quarantined it holds the quarantine
key the bytes were hashed under — a historical fact rather than a current address. Publishing
gives the object a second address in Cloudflare Images, and `deliveryReference` holds it. The
estate's rows, registered with their Cloudflare identifier as their object key, had it copied
across by FC-012's migration, so one column answers "what has to be deleted to withdraw this"
for the whole estate. A unique index makes one delivered object belong to one asset, which is
what the lookup behind every delete depends on.

### What the uploader is told

`GET /file-assets/:assetId/status` answers with the asset and one of five words: `UPLOADING`,
`AWAITING_SCAN`, `SCANNING`, `AVAILABLE`, `REJECTED`. The uploader's own uploads only, and
anything else is the same 404 as an asset that does not exist.

There is no rejection code, signature, engine or key in that response, which is how the fourth
acceptance criterion is met: not by stripping fields but by there being none to strip.

### Uploads made while Redis is down

Steve's decision of 1 October 2026: accept, queue later (FC-042).

- **Queueing a scan waits at most five seconds** (`redisWithin()`), because BullMQ holds a command
  while Redis is away rather than failing it. If Redis does not take it, the asset goes back to
  `RETRY_PENDING` — `AWAITING_SCAN`, "waiting to be scanned", to its uploader — the failure is
  logged, and the upload is answered as usual. This is `ScanRequestProducerService.requestScan`,
  which pictures (`AssetIngressService`) and roster imports (`RosterImportIngressService`) share.
  The asset's and the placement's rows are written before it and do not depend on the job.
- **A re-queue sweep every minute** (`ScanRequeueService`, with its own advisory lock and overlap
  guard, like the alerts) finds uploads with bytes in quarantine and no verdict yet —
  `QUARANTINED`, `SCANNING` or `RETRY_PENDING` — unchanged for more than two minutes, 50 at a time,
  oldest first. For each whose job `<assetId>_<policyVersion>` is not on `file-scan` in any state
  (waiting, prioritised, delayed, active, or kept after failing), and whose verdict is not in
  `file-scan-verdict`'s failed set (the failed-jobs flow's), it sends the request again: an asset in
  `QUARANTINED` or `RETRY_PENDING` is requested as a new upload is, and one in `SCANNING` — its job
  lost with Redis's data, or never sent — has its request sent again with its state left alone. It
  only runs when Redis answers, stops when Redis stops taking requests, and logs
  `[requeue] Scan requests queued again - Count: n, Checked: m`.
- **The worker's side.** Its attempt is keyed by asset, object version, policy and signature epoch,
  not by job, so a request sent again finds whatever the lost one left: nothing, and it is a clean
  first attempt; an attempt still leased, and it waits for the lease to lapse and takes it over; a
  finished attempt, and the worker repeats that verdict. A verdict the backend had already applied
  is refused as a duplicate. One consequence: an attempt that finished `FAILED` answers `RETRY`
  again each time it is asked, until the signature epoch changes and a new attempt can be made,
  so such an upload goes round every few minutes until then (a job each time, nothing more).
- **Rescans are not included.** A campaign's requests are queued by its own batch job, which only
  runs while Redis answers; a rescan that never gets a verdict fails after a day and a later
  campaign asks again.

### Uploads nothing comes back for

A placement left pending for a day is abandoned by the nightly sweep
(`StaleUploadSweepService`, run from the cron job beside the other cleanups). The quarantined
bytes are dropped and the asset is `DELETED` — not `REJECTED`, because nobody refused it. An
object the sweep cannot delete is an orphan in a private bucket with no route out of it; it is
counted in the log line and found again only by W10's inventory.

**Nothing the re-queue sweep would rescue is abandoned.** The re-queue sweep above sends an
upload's lost request within minutes of Redis answering, while this sweep waits a whole day — and
holds for a day after `QUEUES_UNREACHABLE` clears, so even an upload made just before a long
outage is re-queued with the best part of a day to spare. An upload the worker keeps answering
`RETRY` for is still abandoned after its day, as before.

**Not while the pipeline is stopped** (FC-042, Steve's decision of 30 September 2026). The day
counts from the later of the upload and the moment things started again, so the sweep abandons
nothing at all while:

- the worker is silent or paused now — no worker has beaten in two minutes, the heartbeat view
  cannot be read, or every live worker is `PAUSED` (the alerts' definitions, without their grace
  periods);
- publication is paused now;
- a `WORKER_SILENT`, `WORKER_PAUSED` or `QUEUES_UNREACHABLE` alert is open, or cleared less than a
  day ago — the alert's `clearedAt` is when that problem ended; or
- publication was resumed less than a day ago — the switch's `resumedAt`.

A stop too short to open an alert is not counted, which a day's margin absorbs. The sweep then logs
`[sweep] Stale uploads kept; the pipeline was stopped - Reason: …` and the nightly job says why.

**A bucket that cannot be read is retried, not abandoned** (FC-042). Publication reads a picture's
or a roster file's bytes out of quarantine; only a missing object (`NoSuchKey`, `NotFound` or a
404) means the upload was already abandoned and is refused as `NO_BYTES`. Any other error fails
the job, so BullMQ retries it and, after five attempts, keeps it in the failed set, where
`FAILED_JOBS` alerts on it and a retry is allowed.

## What is not here yet

- **Nothing purges a public route on a schedule.** A replacement or a delete purges the one
  picture it touched, and `confirmPurged` records it; sweeping for purges that never happened is
  W10's, with the rescan campaigns.
- **A picture refused for policy on rescan keeps showing.** FC-041 reports it on Scan
  Diagnostics and leaves the decision to a site admin; nothing takes it down automatically — see
  [Rescan campaigns](rescan-campaigns.md).
- **Fleet scopes have specifications and no routes.** `FLEET_COMMUNITY`, `FLEET` and `ARMADA` are
  registered subjects with banner and emblem specifications, and no publisher and no endpoint
  until FC-013.
