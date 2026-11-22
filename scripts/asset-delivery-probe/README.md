# Asset delivery probe

Attempts every public route to a quarantined object and asserts that each one refuses it.

```bash
npm run probe:asset-delivery
```

## Why this exists

Two of FC-008's acceptance criteria are claims about a live Cloudflare account:

- quarantine has no public custom domain, `r2.dev` subdomain, Images variant or download token;
- a later quarantine denies new fetches through legacy URLs, variants and caches.

Neither is a property of this repository. A bucket's public-access setting, an `r2.dev` subdomain,
a cache rule and a Cloudflare Worker route are all configuration, and the plan is explicit that
protecting one R2 access path does not protect another. Reading the code cannot tell you whether
any of them is open. This asks the internet.

Until this has been run against an environment and passed, "quarantine has no public route" is a
design intention for that environment rather than a verified fact about it.

## What it needs

Normally nothing. `npm run probe:asset-delivery` with no arguments is a complete run.

**Required**, and all read from `config/environments/.env`:

| Variable                               | What it is                         |
| -------------------------------------- | ---------------------------------- |
| `CLOUDFLARE_CDN_ROOT_URL`              | The custom delivery domain         |
| `CLOUDFLARE_IMAGES_HASH`               | The Cloudflare Images account hash |
| `CLOUDFLARE_R2_BUCKET_NAME`            | The public delivery bucket         |
| `CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME` | The private bucket                 |

**Optional overrides:**

| Variable                 | Default                                          |
| ------------------------ | ------------------------------------------------ |
| `PROBE_QUARANTINE_KEY`   | `334843800-example-file-q.txt`                   |
| `PROBE_DELIVERY_KEY`     | `334843800-example-file-cdn.txt`                 |
| `PROBE_CONTROL_IMAGE_ID` | The site's "photo unavailable" placeholder image |
| `PROBE_ENV_FILE`         | `config/environments/.env`                       |
| `PROBE_TIMEOUT_MS`       | `10000`                                          |

## The canary objects

One object in each bucket. They earn their place for different reasons, and both are needed.

### In the quarantine bucket — the subject of the test

Without it the run proves nothing: a key that was never written 404s from everywhere, which looks
exactly like a pass. This is the object whose unreachability is the whole claim.

### In the delivery bucket — a second positive control

The image control proves the probe can reach **Cloudflare Images**. It says nothing about whether
the probe could detect a publicly served **R2 object**, which is a different delivery path — and a
refusal from a route that does not work anyway is not evidence of anything.

The delivery canary settles that. Its result is not pass or fail; it says which of two worlds the
estate is in, and the run prints the interpretation:

| Result | Means                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `200`  | The custom domain **does** serve R2 objects, so the custom-domain refusals are meaningful: that route works and still refuses quarantine                     |
| `404`  | The custom domain does **not** reach R2 at all. Quarantine is unreachable through it, but so is everything else, so those refusals prove less than they look |

As of 19 September 2026 the answer is **`200`**: `cdn.startrekonline.info` is bound to the delivery
R2 bucket as well as to Cloudflare Images, and the quarantine bucket is not reachable through it.

That answer arrived only once the canary existed. An earlier attempt to settle the same question by
reading response headers concluded the **opposite** and was wrong — Cloudflare serves a generic 404
for a missing key on an R2 custom domain, so the absence of R2 headers proves nothing. This is why
the delivery canary is worth the object it occupies.

### The objects as they stand

| Bucket            | Key                              |
| ----------------- | -------------------------------- |
| `stoi-quarantine` | `334843800-example-file-q.txt`   |
| `stoi-uploads`    | `334843800-example-file-cdn.txt` |

At the bucket root rather than under an environment prefix, deliberately: whether a bucket is
publicly routed is a property of **the bucket**, not of a key inside it, so one object per bucket
answers for every environment. The names differ so that a URL in the output says which bucket that
line was aimed at.

Neither is a registered asset — no `file_asset` row — so the retention cron will never remove
either, and no run is ever poking at somebody's real roster CSV. Their contents are arbitrary and
carry no explanation of themselves; **this document is the explanation**, along with the residual
checks the probe prints, which name both bucket and key on every run.

**Do not delete them.** If either goes, the probe carries on reporting `PASS` — a key that was
never written 404s from everywhere, which is indistinguishable from a closed route. The script
cannot detect the difference, because doing so would need a credential and it sends none.

If the delivery bucket is publicly served then its canary is publicly readable, which is the whole
point of it.

### Where the values come from

The `CLOUDFLARE_*` values are read from **`config/environments/.env`** — the same file the
application reads — so a checkout already configured for an environment needs no extra setup.
Point it at a different file with `PROBE_ENV_FILE`.

Real environment variables take precedence over that file, so one value can be redirected for a
single run without editing anything:

```bash
CLOUDFLARE_CDN_ROOT_URL=https://dev-cdn.startrekonline.info npm run probe:asset-delivery
```

**Which environment gets probed is therefore whichever one this checkout is configured for.** Worth
knowing before reading a `PASSED`: a pass against the dev CDN says nothing about production.

The two `PROBE_*` values are yours to supply. A run missing anything names everything that is
missing at once, rather than one variable per attempt.

## The control

The default control is the site's "photo unavailable" placeholder — the image everything else
falls back to, so it cannot be deleted or replaced without somebody noticing at once. A user's
profile picture would serve just as well until the day they changed it, at which point this tool
would start reporting INCONCLUSIVE for a reason unconnected to quarantine.

Override it with `PROBE_CONTROL_IMAGE_ID` if an environment's Images account does not hold that
image.

## Variants

The probe tries **all twelve** variants configured on the account, on both the custom domain and
`imagedelivery.net`. Two of them — `square200` and `square512` — are referenced by no code in any
repository, and are public URLs for every image regardless.

**Its list is maintained by hand.** Adding a variant in **R2 and Images → Images → Variants**
creates a delivery route that no code change records, so add it to `VARIANTS` in `probe.mjs` at
the same time. Reading the list from Cloudflare would mean an authenticated API call, and this
script sends no credential.

## What it does not do

- No authenticated request, no credential, no header a stranger could not send.
- No write of any kind. Nothing is uploaded, deleted or purged.
- Redirects are **not** followed. A 302 from a quarantine URL to a public one is a hole, and
  following it would report the destination's status as though it were this route's.

## Reading the result

| Outcome        | Exit | Meaning                                                                       |
| -------------- | ---- | ----------------------------------------------------------------------------- |
| `PASSED`       | 0    | Every public route refused the object, and the control proves the probe works |
| `FAILED`       | 1    | At least one public route served it. The failing URLs are printed             |
| `INCONCLUSIVE` | 3    | The control did not return an image, or a route answered 5xx                  |
| —              | 2    | A required variable is missing                                                |

Each route gets one of three verdicts, not two:

| Verdict | Status              | Meaning                                                                      |
| ------- | ------------------- | ---------------------------------------------------------------------------- |
| `PASS`  | 4xx, or no response | Refused. A hostname that does not resolve is a route that does not exist     |
| `FAIL`  | 2xx, or a redirect  | Served. A 302 from a quarantine URL to a public one is a hole, not a refusal |
| `WARN`  | 5xx                 | Nothing was learned. Check it by hand                                        |

The third verdict exists because a 5xx genuinely means neither. The edge answered and the origin
did not, so the route might serve the object perfectly well once it is working. Calling that a pass
is false comfort and calling it a failure is a false alarm — an `r2.dev` hostname for a bucket that
does not exist answers 500, and so, for all this can tell, might one whose public access is merely
switched off. A run with any `WARN` exits inconclusive: somebody has to look at those routes before
the criterion can be claimed.

## What it cannot establish

The probe prints this at the end of every completed run. A screen of `PASS` lines invites the
conclusion that the criterion is met, and three things are outside its reach:

1. **A custom domain on the quarantine bucket.** Every request goes to the _delivery_ hostname; a
   custom domain on quarantine would be at an address the probe was never given. Read
   **R2 → the bucket → Settings → Custom Domains** instead — it must be empty.
2. **Whether `r2.dev` is disabled.** The `500` is ambiguous. Read
   **Settings → Public Development URL** — it must read Disabled.
3. **Whether the probed object exists.** A key never written 404s from everywhere, which looks
   identical to a pass.

## When to run it

- Before claiming FC-008's second or third acceptance criterion for an environment.
- After any change to the Cloudflare configuration: bucket public access, custom domains, cache
  rules, Workers, Images variants.
- After creating the quarantine bucket in a new environment.
