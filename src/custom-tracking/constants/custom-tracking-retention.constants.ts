/**
 * How long deleted definitions and their answers are kept before they are
 * removed from the database for good.
 *
 * A constant rather than an environment variable, unlike the site's other
 * retention windows. This one is published: the content agreement a user
 * accepts and the Privacy Policy both say 180 days, and the number is part of
 * what they agreed to rather than part of how a deployment is tuned. A
 * variable would let one environment quietly keep data for longer than the
 * page promised, with nothing to notice the difference.
 */
export const CUSTOM_TRACKING_RETENTION_DAYS = 180;

/**
 * How many pictures one reconciliation pass will try to delete.
 *
 * Each one is a request to Cloudflare, so the pass is bounded to keep a
 * backlog from turning the nightly job into an hour of network calls. What is
 * left waits for tomorrow; the queue is durable, so nothing is lost by
 * stopping.
 */
export const CUSTOM_TRACKING_IMAGE_CLEANUP_BATCH = 200;

/**
 * How many failed attempts a queued picture is given before the job stops
 * treating its failure as ordinary and starts reporting it as a fault.
 *
 * The row is kept and still retried. Ten consecutive failures means something
 * is wrong that retrying will not fix — a revoked token, a deleted account —
 * and that is worth a message somebody sees rather than a warning that repeats
 * forever at the same level as a transient timeout.
 */
export const CUSTOM_TRACKING_IMAGE_CLEANUP_ALARM_ATTEMPTS = 10;

/**
 * How many expired rows of each kind one retention sweep will remove.
 *
 * A mass deletion 180 days ago should not become one very long night. What is
 * left over is a day older tomorrow and goes then, oldest first, so nothing
 * waits indefinitely.
 */
export const CUSTOM_TRACKING_PURGE_BATCH = 500;
