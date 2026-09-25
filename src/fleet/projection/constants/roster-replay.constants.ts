/** The queue a Fleet's roster replay is asked for on. */
export const ROSTER_REPLAY_QUEUE = 'fleet-roster-replay';

/** The one kind of job on it. */
export const ROSTER_REPLAY_JOB = 'replay-roster';

/**
 * How many times a replay is tried before it is given up on.
 *
 * A replay that ran out of attempts leaves the Fleet's projection behind
 * what was asked of it, which the projection says, and the sweep asks again.
 */
export const ROSTER_REPLAY_ATTEMPTS = 5;

/** The first retry's delay, doubled for each after it. */
export const ROSTER_REPLAY_BACKOFF_MS = 5_000;

/**
 * How many derived rows go into one INSERT.
 *
 * An episode has nineteen columns, so five hundred of them stay well inside
 * PostgreSQL's limit on bound parameters without the revision leaving its
 * transaction.
 */
export const ROSTER_PROJECTION_WRITE_BATCH = 500;
