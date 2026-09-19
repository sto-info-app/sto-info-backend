#!/usr/bin/env node
//
// Attempts every public route to a quarantined object and asserts each one is
// refused.
//
// FC-008's second and third acceptance criteria are claims about a live
// Cloudflare account. No code in the repository can establish them: a bucket's
// public-access setting, an `r2.dev` subdomain and a cache rule are all
// configuration, and the plan is explicit that protecting one R2 access path
// does not protect another. This asks the internet instead.
//
// It makes no authenticated request, sends no credential and writes nothing.
// Every request is a GET that anybody could make.
//
// The positive control is what makes the result mean anything. A probe that
// returns 404 everywhere because the hostname is wrong looks exactly like a
// probe that passed, so a known-public image is fetched first: if that does
// not come back, the run is INCONCLUSIVE rather than PASSED.
import { join } from 'node:path';

import { config as loadEnvFile } from 'dotenv';

// The same file the application reads, so a checkout configured for an
// environment can be probed without repeating its configuration on the command
// line. Real environment variables win over the file — dotenv does not
// override what is already set — so a single value can still be pointed
// somewhere else for one run:
//
//   CLOUDFLARE_CDN_ROOT_URL=https://dev-cdn.startrekonline.info npm run probe:asset-delivery
//
// Which environment gets probed is therefore whichever one this checkout is
// configured for. That is worth knowing before reading a PASSED.
loadEnvFile({
  quiet: true,
  path:
    process.env.PROBE_ENV_FILE ??
    join(import.meta.dirname, '..', '..', 'config', 'environments', '.env'),
});

/**
 * Variables that were asked for and not found.
 *
 * Declared before the first `requiredEnv` call rather than beside the function,
 * because `const` is not hoisted the way a function declaration is.
 */
const missingEnv = [];

/**
 * The application image used as the positive control.
 *
 * The "photo unavailable" placeholder, which is the right choice for one
 * specific reason: it is the fallback the whole site renders when anything else
 * is missing, so it cannot be deleted or replaced without somebody noticing
 * immediately. A user's profile picture would work equally well until the day
 * they changed it, at which point this tool would start reporting INCONCLUSIVE
 * for a reason that has nothing to do with quarantine.
 *
 * It is `CLOUDFLARE_PHOTO_UNAVAILABLE_ID` in the frontend's
 * `app-image-assets.constants.ts`. Any other permanent application image does
 * just as well — the endeavour laurels, for instance — and
 * `PROBE_CONTROL_IMAGE_ID` overrides it, which is what a Cloudflare Images
 * account with a different set of images would need.
 */
const DEFAULT_CONTROL_IMAGE_ID = '817e04f3-331f-4837-e189-c00a68e4c400';

const CDN_ROOT = requiredEnv('CLOUDFLARE_CDN_ROOT_URL');
const IMAGES_HASH = requiredEnv('CLOUDFLARE_IMAGES_HASH');
const QUARANTINE_BUCKET = requiredEnv('CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME');
const DELIVERY_BUCKET = requiredEnv('CLOUDFLARE_R2_BUCKET_NAME');

/**
 * The object in the quarantine bucket this run tries to reach.
 *
 * A deliberate fixture, at the bucket root rather than under an environment
 * prefix. Whether a bucket is publicly routed is a property of **the bucket**,
 * not of a key within it, so one canary answers for every environment and
 * there is nothing to keep in step as environments come and go. It also cannot
 * be confused with a real object: no `file_asset` row exists for it, so the
 * retention cron will never remove it and no run is ever probing somebody's
 * real roster CSV.
 *
 * Overridable with `PROBE_QUARANTINE_KEY` for pointing at one object once.
 */
const QUARANTINE_KEY =
  process.env.PROBE_QUARANTINE_KEY?.trim() || '334843800-example-file-q.txt';

/**
 * The matching fixture in the **delivery** bucket.
 *
 * A second positive control, and the only thing that gives the custom-domain
 * refusals any weight. The image control proves this script can reach
 * Cloudflare Images; it says nothing about whether it could detect a publicly
 * served R2 object, which is an entirely different delivery path. A refusal
 * from a route that does not work anyway is not evidence of anything.
 *
 * Its answer is not pass or fail. It says which of two worlds the estate is in,
 * and the run prints the interpretation rather than leaving it to be inferred
 * from a status code.
 *
 * Named differently from the quarantine canary on purpose: the two appear in
 * URLs, and `-q` against `-cdn` says which bucket a given line was aimed at
 * without having to work it out from the hostname.
 */
const DELIVERY_CANARY_KEY =
  process.env.PROBE_DELIVERY_KEY?.trim() || '334843800-example-file-cdn.txt';

const CONTROL_IMAGE_ID =
  process.env.PROBE_CONTROL_IMAGE_ID?.trim() || DEFAULT_CONTROL_IMAGE_ID;

reportMissingEnv();

/**
 * Every variant an image in this account is reachable through.
 *
 * **The Cloudflare dashboard is the authority here, not the application code.**
 * Three of these — `square40`, `square200`, `square512` — are configured on the
 * account, and two of them are referenced by no code in any repository. They
 * are live public URLs for every image all the same, which is exactly what the
 * third acceptance criterion means by "variants": a variant nobody uses is
 * still a way to fetch the bytes.
 *
 * This list therefore has to be kept in step with
 * **R2 and Images → Images → Variants** by hand. Discovering it automatically
 * would mean an authenticated Cloudflare API call, and this script deliberately
 * sends no credential. Adding a variant in the dashboard without adding it here
 * leaves a route nothing checks.
 */
const VARIANTS = [
  'public',
  'square40',
  'square100',
  'square200',
  'square300',
  'square512',
  'banner1200x240',
  'banner2400x480',
  'cover640x360',
  'cover1920x1080',
  'portrait133x200',
  'portrait400x600',
];

/** How long to wait before treating a route as unreachable. */
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 10_000);

/**
 * Reads a required environment variable, collecting rather than reporting.
 *
 * Every variable is gathered before anything is said about them, so somebody
 * setting this up for the first time is told the whole list at once instead of
 * discovering it one failed run at a time.
 *
 * @param {string} name - The variable to read.
 * @returns {string} Its value, or an empty string when it is missing.
 */
function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    missingEnv.push(name);

    return '';
  }

  return value;
}

/**
 * Stops the run if anything required is absent, naming all of it.
 *
 * @returns {void}
 */
function reportMissingEnv() {
  if (missingEnv.length === 0) {
    return;
  }

  console.error(`Missing ${missingEnv.length} required value(s):`);
  for (const name of missingEnv) {
    console.error(`  ${name}`);
  }
  console.error(`
These are read from config/environments/.env, the same file the application
reads — override that path with PROBE_ENV_FILE, or set any of them directly.

Nothing else is needed. The object probed defaults to <NODE_ENV>/probe-canary
and the control image to the site's "photo unavailable" placeholder; override
either with PROBE_QUARANTINE_KEY or PROBE_CONTROL_IMAGE_ID.

See scripts/asset-delivery-probe/README.md`);
  process.exit(2);
}

/**
 * Fetches a URL and reports the status, without following redirects.
 *
 * Redirects are not followed on purpose. A 302 from a quarantine URL to a
 * public one is a hole, and following it would report the destination's status
 * as though it were this route's.
 *
 * @param {string} url - The URL to try.
 * @returns {Promise<{status: number | null, note: string}>} What happened.
 */
async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });

    return { status: response.status, note: '' };
  } catch (error) {
    return { status: null, note: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Every check the run performs, filled in as it goes. */
const results = [];

/**
 * Records a route that must not serve anything.
 *
 * Three outcomes, not two, because a 5xx genuinely means neither.
 *
 * - **Refused**: any 4xx, or no response at all. A hostname that does not
 *   resolve is a route that does not exist.
 * - **Served**: any 2xx, and any redirect. A 302 from a quarantine URL to a
 *   public one is a hole, not a refusal.
 * - **Unclear**: any 5xx. The edge answered and the origin did not, so nothing
 *   was learned about whether the route would serve the object if it were
 *   working. Reporting that as a pass is false comfort and reporting it as a
 *   failure is a false alarm — an `r2.dev` hostname for a bucket that does not
 *   exist answers 500, and so, for all this can tell, might one whose public
 *   access is merely switched off. The run says so and asks somebody to look.
 *
 * @param {string} label - What this route is.
 * @param {string} url - The URL to try.
 */
async function expectRefused(label, url) {
  const { status, note } = await probe(url);

  const outcome =
    status === null || (status >= 400 && status < 500)
      ? 'refused'
      : status >= 500
        ? 'unclear'
        : 'served';

  results.push({
    label,
    url,
    status,
    note,
    ok: outcome === 'refused',
    outcome,
    kind: 'refusal',
  });
}

/**
 * Records a route whose answer is information rather than a verdict.
 *
 * Neither a pass nor a failure, and deliberately not counted towards either.
 * Some routes are worth measuring because of what they say about the *other*
 * results, not because there is a right answer.
 *
 * @param {string} label - What this route is.
 * @param {string} url - The URL to try.
 */
async function observe(label, url) {
  const { status, note } = await probe(url);

  results.push({ label, url, status, note, ok: true, kind: 'observation' });
}

/**
 * Says what the delivery-bucket canary implies about the rest of the run.
 *
 * The custom-domain refusals are only meaningful if the custom domain would
 * have served an R2 object it *did* have. This settles that from the inside,
 * rather than by inferring it from response headers.
 *
 * @returns {string} A sentence about the delivery path, for the summary.
 */
function describeDeliveryCanary() {
  const canary = results.find(result => result.kind === 'observation');

  if (canary.status === null) {
    return `The delivery canary got no response (${canary.note}), so nothing can be said about whether\nthe custom domain serves R2 objects.`;
  }

  if (canary.status >= 200 && canary.status < 300) {
    return `The custom domain DOES serve R2 objects — the delivery canary came back ${canary.status}.\nThe custom-domain refusals above are therefore meaningful: that route works, and it\nstill would not serve the quarantined object.`;
  }

  if (canary.status === 404) {
    return `The custom domain does NOT appear to serve R2 objects — the delivery canary, which is\nreally in that bucket, came back 404. So the custom-domain refusals above prove less\nthan they look: that route is not reaching R2 at all. It is still correct that\nquarantine is unreachable through it; it is simply unreachable for everyone.\n\nIf the canary is definitely uploaded, this means cdn is bound to Cloudflare Images\nonly, and the R2-object rows of the inventory in docs/file-assets.md are dead paths.`;
  }

  return `The delivery canary answered ${canary.status}, which settles nothing either way.`;
}

/**
 * Records a route that must serve something, so the run can be believed.
 *
 * @param {string} label - What this route is.
 * @param {string} url - The URL to try.
 */
async function expectServed(label, url) {
  const { status, note } = await probe(url);

  results.push({
    label,
    url,
    status,
    note,
    ok: status !== null && status >= 200 && status < 300,
    kind: 'control',
  });
}

/**
 * Runs every check.
 *
 * @returns {Promise<void>}
 */
async function main() {
  console.log(`Probing quarantine key: ${QUARANTINE_KEY}`);
  console.log(`CDN root: ${CDN_ROOT}\n`);

  // The control. If this fails nothing below can be trusted.
  await expectServed(
    'control: a known public image is reachable',
    `${CDN_ROOT}/cdn-cgi/imagedelivery/${IMAGES_HASH}/${CONTROL_IMAGE_ID}/public`,
  );

  // The second control, and the only thing that makes the custom-domain
  // refusals below mean anything. The image control proves this script can
  // reach Cloudflare Images; it says nothing about whether it could detect a
  // publicly served **R2 object**, which is a different delivery path
  // altogether. The same key in the delivery bucket answers that, and the
  // answer is not pass or fail — it is which of two worlds we are in. See
  // {@link describeDeliveryCanary}.
  await observe(
    'delivery bucket canary, custom domain',
    `${CDN_ROOT}/${DELIVERY_CANARY_KEY}`,
  );

  // 1 and 3: the custom domain, straight at the object.
  await expectRefused(
    'custom domain, direct object',
    `${CDN_ROOT}/${QUARANTINE_KEY}`,
  );

  // 4: Image Resizing, which reaches objects the direct path serves.
  await expectRefused(
    'custom domain, Image Resizing',
    `${CDN_ROOT}/cdn-cgi/image/width=300,height=300,fit=cover,format=auto/${QUARANTINE_KEY}`,
  );

  // 5: the r2.dev subdomain, on both buckets. Enabling it is a single toggle
  // in the Cloudflare dashboard and nothing in the codebase would notice.
  await expectRefused(
    'r2.dev subdomain, quarantine bucket',
    `https://${QUARANTINE_BUCKET}.r2.dev/${QUARANTINE_KEY}`,
  );
  await expectRefused(
    'r2.dev subdomain, delivery bucket',
    `https://${DELIVERY_BUCKET}.r2.dev/${QUARANTINE_KEY}`,
  );

  // 2: every Images variant, on the custom domain and on imagedelivery.net.
  // A quarantined object has no Images identifier at all, so these ask whether
  // the key has somehow been made to work as one.
  for (const variant of VARIANTS) {
    await expectRefused(
      `Images variant ${variant}, custom domain`,
      `${CDN_ROOT}/cdn-cgi/imagedelivery/${IMAGES_HASH}/${QUARANTINE_KEY}/${variant}`,
    );
    await expectRefused(
      `Images variant ${variant}, imagedelivery.net`,
      `https://imagedelivery.net/${IMAGES_HASH}/${QUARANTINE_KEY}/${variant}`,
    );
  }

  report();
}

/**
 * Says what a passing run still does not establish.
 *
 * Printed even on a pass, because the gap is not obvious from the output and a
 * screen of PASS lines invites the conclusion that the criterion is met.
 *
 * The important one is the custom domain. Every request this script makes goes
 * to the **delivery** hostname, so what those routes prove is that the delivery
 * domain and the Images account do not serve a key of quarantine's shape. A
 * custom domain bound to the *quarantine* bucket would live at some hostname
 * nobody has told this script about, and an unknown hostname cannot be probed.
 * That one is settled by reading the bucket's own settings and no other way.
 *
 * @returns {void}
 */
function reportResidualChecks() {
  console.log(`
Still to check by hand — this script cannot reach any of it:

  1. Quarantine bucket -> Settings -> Custom Domains is EMPTY.
     Every request above went to the delivery hostname. A custom domain on the
     quarantine bucket would be at an address this script was never given, so
     its absence is a dashboard fact, not a probe result.

  2. Quarantine bucket -> Settings -> Public Development URL reads Disabled.
     The r2.dev status is ambiguous; see the note this prints on a 5xx.

  3. Both canary objects still exist:
       ${QUARANTINE_BUCKET} -> ${QUARANTINE_KEY}
       ${DELIVERY_BUCKET} -> ${DELIVERY_CANARY_KEY}
     A key that was never written, or that somebody tidied away, 404s from
     everywhere — which looks exactly like a pass. This script cannot tell the
     difference, because checking would need a credential and it sends none.`);
}

/**
 * Prints the result and sets the exit code.
 *
 * @returns {void}
 */
function report() {
  const control = results.find(result => result.kind === 'control');
  const refusals = results.filter(result => result.kind === 'refusal');
  const served = refusals.filter(result => result.outcome === 'served');
  const unclear = refusals.filter(result => result.outcome === 'unclear');

  const labels = { refused: 'PASS', served: 'FAIL', unclear: 'WARN' };

  for (const result of results) {
    const status = result.status ?? `no response (${result.note})`;
    const verdict =
      result.kind === 'observation'
        ? 'INFO'
        : result.kind === 'control'
          ? result.ok
            ? 'PASS'
            : 'FAIL'
          : labels[result.outcome];

    console.log(`${verdict}  ${status}  ${result.label}`);
    if (verdict !== 'PASS') {
      console.log(`      ${result.url}`);
    }
  }

  console.log(`\n${describeDeliveryCanary()}\n`);

  if (!control.ok) {
    console.error(`INCONCLUSIVE: the positive control did not return an image, so the refusals
above prove nothing — a probe pointed at the wrong hostname refuses everything
too, and looks identical to a pass.

Likely causes, in order:
  - CLOUDFLARE_CDN_ROOT_URL or CLOUDFLARE_IMAGES_HASH is wrong for this
    environment;
  - this Cloudflare Images account does not hold ${CONTROL_IMAGE_ID}, which is
    the default control. Set PROBE_CONTROL_IMAGE_ID to any permanent image in
    the account this environment uses.`);
    process.exit(3);
  }

  if (served.length > 0) {
    console.error(
      `FAILED: ${served.length} of ${refusals.length} public routes served a ` +
        'quarantined object.',
    );
    process.exit(1);
  }

  if (unclear.length > 0) {
    console.error(`INCONCLUSIVE: ${unclear.length} of ${refusals.length} routes answered 5xx, which says nothing
about whether they would serve the object.

An r2.dev route is the usual one. Cloudflare answers 500 there both for a bucket
that does not exist and, as far as this can tell, for one whose public access is
simply switched off — so the status cannot separate "safely disabled" from
"not there at all". Settle it by eye instead:

  R2 → the bucket → Settings → Public Development URL

It must read Disabled. That takes one glance and is conclusive, which the HTTP
status is not.`);
    reportResidualChecks();
    process.exit(3);
  }

  console.log(
    `PASSED: all ${refusals.length} public routes refused the quarantined ` +
      'object, and the control confirms the probe can tell the difference.',
  );
  reportResidualChecks();
}

await main();
