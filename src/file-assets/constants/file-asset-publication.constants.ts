/**
 * The queue that turns a cleared asset into a published picture.
 *
 * Internal to this application, unlike the two scanning queues, which are a
 * contract with another repository. Nothing outside this process reads or
 * writes it, so it is named here rather than in a shared contract file.
 */
export const FILE_ASSET_PUBLICATION_QUEUE = 'file-asset-publication';

/** The one job the publication queue carries. */
export const FILE_ASSET_PUBLICATION_JOB = 'publish-asset';

/**
 * How many times the publication of one asset is attempted.
 *
 * Cloudflare Images is the thing being retried. Five attempts with backoff
 * covers an outage of a few minutes, after which the job stays in the failed
 * set where somebody can see it and the asset stays `CLEAN` — scanned,
 * unpublished, and recoverable by hand.
 */
export const FILE_ASSET_PUBLICATION_ATTEMPTS = 5;

/** The first backoff between publication attempts, in milliseconds. */
export const FILE_ASSET_PUBLICATION_BACKOFF_MS = 5_000;

/**
 * The `app_setting` that pauses publication (FC-042): a JSON object,
 * `{"paused":false,"resumedAt":"<ISO instant>"}` when publication runs
 * (`{"paused":false}` as seeded, never paused), and
 * `{"paused":true,"pausedAt":"<ISO instant>","pausedByUserId":"<uuid>"}`
 * while it is paused. One key, so the switch and who threw it when are
 * written and read together.
 */
export const FILE_PUBLICATION_PAUSED_SETTING_KEY = 'FILE_PUBLICATION_PAUSED';

/**
 * How long a publication job that finds publication paused is put back for,
 * in milliseconds. Only reached when the queue itself was not paused — Redis
 * lost, or the pause not yet applied — since a paused queue hands out no
 * jobs.
 */
export const PUBLICATION_PAUSED_RECHECK_MS = 60_000;

/**
 * How long an upload may sit pending before the nightly sweep gives up on it.
 *
 * Generous on purpose. A scan takes seconds, but ADR-0020 makes a paused
 * worker an ordinary state: during a `freshclam` outage the queue simply
 * waits, and an upload caught by that must still publish when the scanner
 * comes back rather than being swept away overnight. A day is far longer than
 * any outage the worker recovers from on its own and far shorter than a
 * person will wait before uploading again.
 */
export const STALE_PLACEMENT_HOURS = 24;

/**
 * The most placements one sweep abandons.
 *
 * A bound rather than a policy. Each one is a delete against R2 and two
 * writes, and a sweep that found a hundred thousand of them should take
 * several nights rather than one very long transaction.
 */
export const STALE_PLACEMENT_SWEEP_LIMIT = 500;
