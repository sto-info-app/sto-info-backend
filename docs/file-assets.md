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
rather than at the object that ended up stored. Gating them is FC-012; rescanning them is W10.

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
| 7   | R2 S3 API, delivery bucket   | `cloudflareR2AccessKey` / `cloudflareR2Secret`                     | Writes public images                                                          |
| 8   | R2 S3 API, quarantine bucket | `cloudflareR2QuarantineAccessKey` / `cloudflareR2QuarantineSecret` | Reads and writes quarantine. **Must not** carry access to the delivery bucket |
| 9   | Cloudflare Images API        | `cloudflareImagesApiKey`                                           | Uploads and deletes images                                                    |
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
3. The scan, then `recordCleanVerdict` — or `reject`, which tells the uploader nothing beyond
   `FILE_REJECTED_BY_SCANNER_MESSAGE`.
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

## What is not here yet

- **One thing registers an asset: roster imports.** FC-009 is the first producer, and its
  sanitised CSVs are the only rows this registry holds that are not legacy `UNVERIFIED` ones —
  see [Roster imports](roster-imports.md). Every *image* caller is still on the old path. FC-012
  moves them across; `ImageUploadsService` still scans synchronously and publishes immediately,
  and is untouched by this work apart from no longer naming the signature it matched.
- **Nothing scans one.** The worker's `upload_files` row records what a scanner did; joining the
  two and driving `SCANNING` → `CLEAN` is FC-010.
- **Nothing purges a public route.** `confirmPurged` records that it happened; performing it is
  W10's, with the rescan campaigns.
- **Legacy assets are counted, not gated.** Every one of them is `UNVERIFIED` and still served by
  its existing public URL. That is deliberate — gating them before there is a scanner to clear them
  would take every profile picture off the site.
