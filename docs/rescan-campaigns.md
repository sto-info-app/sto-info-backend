# Rescan campaigns (FC-041)

A rescan campaign scans published pictures again, against today's scanner definitions and upload
policy. It is how the legacy estate, uploaded before scanning began and still `UNVERIFIED`, is
finally scanned, and how a site admin rescans pictures after a signature update or a policy
change.

Steve's decisions of 29 September 2026:

| Question | Decision |
| -------- | -------- |
| How the worker reaches a published picture | The API stages a copy in the quarantine bucket; the worker's access and contract are unchanged |
| What a clean legacy picture becomes | `AVAILABLE` |
| Who is told about an infection | Every site admin, in-app, with the asset and the code; the owner, without detail |
| When the legacy estate is scanned | Once, automatically, after release; after that, when a site admin starts a campaign |
| A picture refused for policy on rescan | Keeps showing, and is reported on Scan Diagnostics for a site admin to take down or keep, with a reason (FC-050) |

## How a picture is rescanned

`file_rescan_campaign` holds each campaign: who started it, its selection, its cursor and what
it has found. `file_rescan` holds each picture's rescan.

For each picture a campaign selects, `RescanCampaignService`:

1. reads the picture from Cloudflare Images, or a legacy R2 portrait from R2;
2. records its SHA-256 and a declared type read from its first bytes (PNG, JPEG, GIF, WebP or
   BMP, otherwise `application/octet-stream`, which the worker refuses);
3. stages the bytes in the quarantine bucket under `<NODE_ENV>/rescans/<rescanId>`;
4. writes the `file_rescan` row, then queues a scan request exactly as an upload does, with the
   job ID `rescan_<rescanId>` and a priority.

The worker scans the staged copy like any upload, and never learns it is a rescan. When the
verdict comes back, `ScanVerdictService` hands it to `RescanVerdictService` first. That service
matches it by the asset and the staged key, so an upload's verdict never matches a rescan and a
rescan's verdict never reaches the upload path. A repeated delivery of a verdict changes nothing.

| Verdict | What happens |
| ------- | ------------ |
| Clean, with the hash the copy was staged with | The picture stays. Its verdict fields are brought up to date, its hash and type filled in if missing, and a legacy picture becomes `AVAILABLE` |
| `INFECTED` | The picture is taken down: delivery is revoked first, so it is never signed again, then its image is deleted. The asset records the code. Every enabled site admin gets an in-app warning with the asset ID and the code, linking to Scan Diagnostics; the owner is told only that a picture failed a security check and was removed |
| A policy refusal (for example `CONTENT_TYPE_MISMATCH` or `SIZE_LIMIT_EXCEEDED`) | The picture keeps showing. The rescan records the code, and Scan Diagnostics lists it for a site admin to decide — see [Deciding a policy refusal](#deciding-a-policy-refusal) |
| `HASH_MISMATCH`, `OBJECT_MISSING`, `RETRY_BUDGET_EXHAUSTED`, a retry, or a clean verdict for different bytes | No verdict: the rescan fails, and a later campaign may try again |

The staged copy is deleted whatever the verdict. A copy that cannot be deleted is left for the
quarantine bucket's own sweep.

## Campaigns

A campaign selects published pictures (in Cloudflare Images or legacy R2, `AVAILABLE` or
`UNVERIFIED`) and narrows them by any of:

- **kinds**: profile pictures, Character portraits, Storytime artwork, Custom Tracking pictures
  and Fleet artwork. Roster files are never rescanned;
- **uploaded on or after**, and **uploaded before**;
- **not scanned for** this many days, or never;
- **only pictures never scanned** (`UNVERIFIED`).

With nothing chosen, it rescans every published picture.

- **Behind uploads.** Every rescan is queued with a BullMQ priority. A new upload has none, so it
  is always taken first. A campaign's order is Low (100) or High (10), and of two campaigns the
  higher goes first. A campaign also holds back for 30 seconds whenever 25 scan requests are
  already waiting, so it never fills the quarantine bucket with copies nobody will scan for hours.
- **Once per epoch.** A picture is rescanned once per upload policy version and signature version,
  however many campaigns overlap. A unique index on `file_rescan` (asset, policy, epoch), for every
  rescan that did not fail, enforces it. The signature version read before staging is the one the
  worker last recorded, which lags an update until its next scan, so the check also accepts a
  verdict's own signature version. A picture skipped this way counts as `skipped`.
- **Checkpointed.** Batches of 10 run on the `file-rescan` queue. A campaign's cursor is the last
  picture it staged, so a pause, a crash or a failure resumes after it. A pause takes effect after
  the batch under way. A campaign stopped by an error can be resumed or cancelled. A cancelled
  campaign stages nothing more, but rescans already asked for still get their verdicts.
- **Counted.** Each campaign counts pictures asked for, clean, infected, refused, failed and
  skipped. The counts are updated in the database, so a batch and a verdict landing together lose
  nothing.

### The legacy campaign

At 04:41 UTC each night, `RescanScheduler`:

- starts the legacy campaign, if there is none yet and there are `UNVERIFIED` published pictures.
  It rescans only those, at Low priority, and runs once. After it, campaigns are a site admin's;
- counts as failed every rescan still waiting for a verdict after 24 hours, and deletes its staged
  copy, so a later campaign can try that picture again.

## Scan Diagnostics

`/admin/rescan-campaigns`, `ADMIN` only:

- lists the 20 latest campaigns, how many rescans are waiting, how many legacy pictures have never
  been scanned, and the 50 latest pictures found infected or refused for policy and not yet
  decided, by rescan, asset ID and code only;
- starts a campaign with a selection and a reason;
- pauses, resumes and cancels a campaign with a reason;
- takes down or keeps a picture refused for policy, with a reason (FC-050).

Each is written to the site admin log as `RESCAN_STARTED`, `RESCAN_PAUSED`, `RESCAN_RESUMED` or
`RESCAN_CANCELLED`, with the campaign as its subject and the selection in `detail`. See
[Admin audit](admin-audit.md).

### Deciding a policy refusal

Steve's decision of 30 September 2026 (FC-050). `POST
/admin/rescan-campaigns/findings/:rescanId/decision` takes `{ decision: TAKEN_DOWN | KEPT, reason }`
for a rescan that refused its picture for policy and has not been decided:

- **Taken down.** As an infection is: delivery is revoked, then the image is deleted, and the asset
  records the code. The owner is told, without the reason, that a picture was removed for breaking
  the site's rules for pictures.
- **Kept.** Nothing about the picture changes. A later rescan under a new policy or signature
  version may refuse it again.

Either way `file_rescan` records the decision, when and by whom, the site admin log records
`IMAGE_TAKEN_DOWN` or `IMAGE_KEPT` with the reason, and the finding leaves the list. A rescan that
is not a policy refusal, or has been decided, answers 409; the conditional update settles two site
admins deciding at once. `CHK_file_rescan_decision` holds that only a policy refusal is decided,
and always with a time.

## What this does not prove locally

An infected verdict was checked live with a synthetic worker verdict. On the development machine,
the local antivirus corrupts the EICAR test file in transit to MinIO and to clamd, so the worker
never receives it intact. The end-to-end infection check runs on the live stack in FC-052.
