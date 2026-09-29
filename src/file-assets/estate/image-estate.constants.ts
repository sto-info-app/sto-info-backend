/** The queue the image estate's work runs on (FC-040). Internal. */
export const IMAGE_ESTATE_QUEUE = 'image-estate';

/** One reconciliation: `{ inventoryId }`. */
export const IMAGE_INVENTORY_JOB = 'inventory';

/** One batch of a run: `{ runId }`. */
export const IMAGE_ESTATE_BATCH_JOB = 'batch';

/**
 * How many pictures a batch handles. Each is a download, an upload and a
 * transaction, so a batch is a few seconds' work, and a pause takes effect
 * at the next batch.
 */
export const IMAGE_ESTATE_BATCH_SIZE = 20;

/** How many IDs an inventory names in each of its lists. */
export const IMAGE_INVENTORY_SAMPLE = 50;
