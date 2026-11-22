import base from './stryker.config.mjs';

/**
 * Config for one shard of the weekly full mutation run
 * (scripts/mutation-shards.mjs). It is stryker.config.mjs without the break
 * threshold: a shard holds only part of the mutate set, so the merge job
 * applies the threshold to the combined score instead.
 */
export default {
  ...base,
  thresholds: { ...base.thresholds, break: null },
};
