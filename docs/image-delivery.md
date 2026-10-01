# Private image delivery (FC-040)

Every published picture is a private Cloudflare Images object. Only an address the API signs can
reach it, and the API signs one only while the picture's asset may be shown. Before FC-040, every
picture was public at two hostnames for as long as it existed, whatever the registry said about it.

Steve's decisions of 29 September 2026:

| Question | Decision |
| -------- | -------- |
| How old addresses stop getting round an asset's state | Signed Cloudflare Images URLs |
| A legacy (`UNVERIFIED`) picture until FC-041 scans it | Keeps showing, never marked clean |
| How the estate moves | An admin-run, checkpointed job on Scan Diagnostics, undoable, deleting nothing |
| Cloudflare objects nothing points at | Reported, not deleted |
| Legacy R2 Character portraits | Copied into Cloudflare Images; the R2 bucket's public access closed afterwards |
| How long a signed address lasts | Until the end of the next UTC day |
| Where admins run it | A new section of Scan Diagnostics |
| The old public copies | Deleted by a separate "Retire old copies" run, after checking the site |
| Which pictures | Every published picture, legacy or since FC-012 |
| The signing key | A new field in the application's AWS secret, `cloudflareImagesSigningKey` |

## What Cloudflare does

A live check on the dev account on 29 September 2026, with three throwaway images since deleted,
established:

- **A custom-ID image cannot be private.** Cloudflare refuses both uploading one private and making
  one private later (error 5410). Every picture before FC-040 has a custom ID
  (`<env>-<userId>-<kind>-…`), so each has to be copied to a new image under an ID Cloudflare
  generates.
- **Unsigned is refused, signed is served, on both hostnames.** A private image answers 403 to an
  unsigned request at `imagedelivery.net` and at the site's `/cdn-cgi/imagedelivery/` address, and
  200 to a signed one at either. An expired or wrong signature is refused.
- **The signature is over the account path.** `sig` is the HMAC-SHA256, in hexadecimal, of
  `/<account hash>/<image id>/<variant>?exp=<expiry>` under the account's Images signing key.
  Signing the longer `/cdn-cgi/imagedelivery/…` path is refused.
- **A signed address for a public image works too**, so the API can sign everything before any
  picture is private.
- **No variant is set to "always allow public access".** One that was would bypass signing, and the
  runbook checks for it.

## Signing

`ImageSigningService` reads `cloudflareImagesSigningKey` from the application's AWS secret. An
address signed at any moment expires at the end of the next UTC day, so everybody who asks on the
same day gets the same address, and Cloudflare and browsers can cache it.

`ImageUrlSigningInterceptor` is a global interceptor, registered outside the serialiser. It walks
every response once it is serialised and looks up each Cloudflare Images address in the registry
by its image ID, with one query for the whole response:

- A picture that may be shown (`AVAILABLE`, or `UNVERIFIED` legacy) gets a signed address.
- A picture that may not (revoked, rejected, deleted, never published) is replaced by the site's
  "photo unavailable" image, so a stale reference never reaches a browser.
- An address the registry does not know is left as it is. The site's own artwork (icons, the team
  page, the placeholder itself) lives in Cloudflare Images too, and it is public.

The browser no longer builds a picture's address. The API sends `bannerImageUrl` and
`emblemImageUrls` (by variant) for Communities, Fleets and Armadas, `coverImageUrl` for news posts,
and `imageUrl` for a Custom Tracking picture, alongside the IDs. Profile, Character and Storytime
pictures already came as addresses.

Without the key nothing is signed, new pictures are uploaded public, no copy can start, and the
log says so at start-up. The site keeps working as it did before FC-040.

## Uploads

A picture published after FC-040 goes to Cloudflare Images under a generated ID, private whenever
the key is set. The ID no longer carries the uploader's user ID, and the upload's metadata keeps
only the environment, the kind of record, which record and when. `file_asset.deliveryPrivate` says
which pictures are private.

## The estate

`image_estate_run` holds each run, and one is open at a time. `image_estate_step` holds each
picture's copy: what it was, what it became, and every row it repointed. Both are driven from Scan
Diagnostics (`/admin/image-estate`, ADMIN only). Each run is started, paused and resumed with a
reason, which goes in the site admin log.

- **Copy.** First, every reference a feature row holds that the registry does not know is
  registered as `UNVERIFIED`, never presumed clean. Then, for each picture still public:
  - The copy reads its original (or the R2 object) and records its SHA-256, size and type for
    FC-041's scans.
  - A custom-ID picture is uploaded again, private, under a generated ID. A generated-ID picture
    is made private in place.
  - In one transaction, the copy points the registry and every row holding the old ID at the
    private copy, and gives each row with no placement one.
  - If the picture changed meanwhile, the copy is dropped and the picture stays as it was.
- **Undo.** Every copy not yet retired is put back: the rows and the registry point at the old
  public copy again, the placements the copy made go, and the private copy is deleted. A picture
  that may no longer be shown is never put back.
- **Retire.** Every old public copy is deleted, image or R2 object; one already gone counts as
  deleted. After this, a picture's old addresses stop working and its copy cannot be undone.

Every run is checkpointed. Its cursor is the last row it handled, and a pause takes effect after
the batch under way (20 pictures). A crash leaves at most one copy half made; the next batch
deletes it and copies the picture again. A failed run is resumed like a paused one.

Withdrawing a picture that has been copied but not retired also deletes its old public copy, so a
replacement never leaves one behind.

## The inventory

"Take an inventory" reconciles the estate and changes nothing. It reports:

- every feature column that holds a picture (17), with how many rows hold one, how many the
  registry knows, and how many are R2 keys;
- the registry's published pictures by kind, state, storage and whether they are private;
- the copies by state;
- Cloudflare's listing for this environment: how many are private, public, old copies awaiting
  retirement, orphans (nothing points at them) and missing (the registry shows them, Cloudflare
  does not have them), with up to 50 IDs of each. Images of other environments, and the site's own
  artwork, are counted as elsewhere.

## Runbook

1. **Create the signing key.** In Cloudflare, R2 and Images → Images → Keys, copy the key into
   `cloudflareImagesSigningKey` in the environment's AWS secret (`sto_info_app_local_dev` locally,
   and production's before release), then restart the API. Check that no variant has "always
   allow public access".
2. **Take an inventory** and read it: every column registered, nothing unexpected missing.
3. **Copy to private.** Watch the counts, and pause if anything looks wrong.
4. **Check the site.** Profile pictures, portraits, Storytime, Custom Tracking and Fleet artwork
   should all show. A picture that cannot be shown should show "photo unavailable".
5. **Undo** if needed. Everything not yet retired goes back as it was.
6. **Retire old copies.** From here there is no undo.
7. **Take another inventory.** Public, orphans and awaiting retirement should all be zero, or
   accounted for.
8. **Close the R2 bucket's public access** once the inventory shows no R2 keys: remove the custom
   domain binding from the delivery bucket and check `r2.dev` is off. This is done on the live
   account in FC-052.

## Rolling back the application

Render redeploys an older build with `npm run start:render`, which runs `migration:run` first. Against
a newer database that finds nothing to do, so the old build starts on today's schema. Three rules
follow.

**Never roll back to a build from before FC-012.** Those builds upload a picture straight to
Cloudflare Images, or the public R2 bucket, and write its ID into the feature row, with no scan and
no registry row. FC-012 closed that path in the series `7b257d6c`…`da25348e` (20 September 2026); a
build without `da25348e` still has it. On 30 September 2026 neither `production` (1.4.23) nor
`development` (1.4.28) contains it, so every release before Fleet Community v1 has the path. FC-042
added two defences so that a rollback done by mistake does not reopen it:

- **The database refuses the write.** Migration `1797300000000-GuardPublishedImageReferences` puts a
  trigger on every picture column (the 17 in [the inventory](#the-inventory)). A column takes a
  value only when a `file_asset` holds that value as its `deliveryReference` and is `AVAILABLE`, or
  `UNVERIFIED` for the legacy estate. NULL, and an update that leaves the value as it was, always
  pass. A refusal raises SQLSTATE `IRG01`, "`<table>.<column>` may only hold a picture the asset
  registry has published", and never includes the value. An old build never creates a
  `file_asset` row, so it cannot make its own upload pass.
- **The old credentials stop working.** The API reads the Cloudflare Images token and the public R2
  key pair only as `cloudflareImagesGatedApiKey`, `cloudflareR2GatedAccessKey` and
  `cloudflareR2GatedSecret`, which hold new tokens. The old names, `cloudflareImagesApiKey`,
  `cloudflareR2AccessKey` and `cloudflareR2Secret`, hold tokens that are revoked, so an old build's
  upload fails at Cloudflare before it reaches the database. This matters as well as the trigger:
  an old build uploads before it writes the row, and the IDs it chooses are predictable.

What an old build does, then: it starts, and serves what does not need a picture written. Every
upload fails with a server error, because Cloudflare refuses the revoked token and, if it did not,
the trigger would refuse the row. If the old keys are deleted from the secret rather than only
revoked, an old build does not start at all ("Missing Cloudflare R2 access key or secret").

**The guard cannot be rolled back.** Its down migration refuses, so `migration:revert` stops there
and every migration before it stays in place. The way back from a bad migration is a new one that
rolls forward. Removing the guard deliberately is a reviewed migration of its own, never a revert.

**Before FC-040, nothing is signed.** A release from before FC-040 can show no private picture.

- Before rolling back past FC-040, run Undo. That is possible only until the old copies are
  retired.
- After retirement, the old public copies are gone. A rollback leaves pictures unshown until
  FC-040 is deployed again, so don't roll back past it then.

FC-040's migration can no longer be reverted, because the guard's sits above it and refuses.
