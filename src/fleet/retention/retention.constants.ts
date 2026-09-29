/** How many rows a retention job deletes at a time (FC-037). */
export const RETENTION_BATCH_SIZE = 500;

/**
 * How many batches one run of a job deletes before stopping. Whatever is
 * left is still due, so the next run carries on from it.
 */
export const RETENTION_MAX_BATCHES = 40;
