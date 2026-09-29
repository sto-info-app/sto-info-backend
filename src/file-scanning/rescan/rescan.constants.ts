/** The queue campaign batches run on (FC-041). Internal to this application. */
export const RESCAN_CAMPAIGN_QUEUE = 'file-rescan';

/** One batch of a campaign: `{ campaignId }`. */
export const RESCAN_BATCH_JOB = 'campaign-batch';

/** How many pictures a batch stages. */
export const RESCAN_BATCH_SIZE = 10;

/**
 * How many scan requests may be waiting before a campaign holds back. New
 * uploads jump the queue anyway; this stops a campaign filling the
 * quarantine bucket with copies nobody will scan for hours.
 */
export const RESCAN_QUEUE_CEILING = 25;

/** How long a held-back batch waits before looking again. */
export const RESCAN_BACKOFF_MS = 30_000;

/**
 * BullMQ priorities for a campaign's scan requests. A job with no priority,
 * which is every new upload, is always taken first; of two campaigns, the
 * lower number goes first.
 */
export const RESCAN_PRIORITIES = { HIGH: 10, LOW: 100 } as const;

/** How long a rescan may wait for its verdict before it counts as failed. */
export const RESCAN_STALE_HOURS = 24;

/** The epoch the worker records when the engine does not say. */
export const UNKNOWN_DEFINITION_EPOCH = 'unknown';

/**
 * The rejections that mean a picture is infected, and taken down. Every
 * other rejection a rescan can bring is either a policy refusal, reported
 * and left showing (Steve's decision of 29 September 2026), or a failure to
 * reach a verdict.
 */
export const INFECTION_CODES: readonly string[] = ['INFECTED'];

/** The rejections that mean no verdict was reached. */
export const NO_VERDICT_CODES: readonly string[] = [
  'HASH_MISMATCH',
  'OBJECT_MISSING',
  'RETRY_BUDGET_EXHAUSTED',
];
