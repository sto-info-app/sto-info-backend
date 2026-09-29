/** The queue transcripts are written on (FC-035). */
export const CHAT_TRANSCRIPT_QUEUE = 'chat-transcript';

/** The one kind of job on it. */
export const CHAT_TRANSCRIPT_JOB = 'write-transcript';

/** How many times writing a transcript is tried. */
export const CHAT_TRANSCRIPT_ATTEMPTS = 3;

/** The first retry's delay, doubled for each after it. */
export const CHAT_TRANSCRIPT_BACKOFF_MS = 5_000;

/** How long a written transcript may be downloaded, in milliseconds. */
export const CHAT_TRANSCRIPT_LIFETIME_MS = 24 * 3_600_000;

/**
 * How long a transcript may wait to be written before the sweep gives up on
 * it, in milliseconds. Well past every retry.
 */
export const CHAT_TRANSCRIPT_STALE_MS = 3_600_000;

/** How many messages are read at a time while writing one. */
export const CHAT_TRANSCRIPT_BATCH = 1_000;
