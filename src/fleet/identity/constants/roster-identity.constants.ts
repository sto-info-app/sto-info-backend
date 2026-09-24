/** The queue a Fleet's identity recompute is asked for on. */
export const ROSTER_IDENTITY_QUEUE = 'fleet-roster-identity';

/** The one kind of job on it. */
export const ROSTER_IDENTITY_RECOMPUTE_JOB = 'recompute-identities';

/**
 * How many times a recompute is tried before it is left in the failed set.
 *
 * A recompute reads and writes one Fleet's rows and nothing outside the
 * database, so the failure worth retrying is a lock timeout or a dropped
 * connection, and five attempts over about two and a half minutes outlasts
 * either.
 */
export const ROSTER_IDENTITY_RECOMPUTE_ATTEMPTS = 5;

/** The first retry's delay, doubled for each after it. */
export const ROSTER_IDENTITY_RECOMPUTE_BACKOFF_MS = 5_000;

/**
 * How many rows go into one INSERT or upsert.
 *
 * An export is capped at two thousand rows, so a Fleet's first import can
 * bring two thousand aliases with it. Batches keep every statement well
 * inside PostgreSQL's limit on bound parameters.
 */
export const ROSTER_IDENTITY_WRITE_BATCH = 500;
