import base from './stryker.config.mjs';

/**
 * Config for one shard of the weekly full mutation run
 * (scripts/mutation-shards.mjs). It is stryker.config.mjs with two changes:
 *
 * - No break threshold: a shard holds only part of the mutate set, so the
 *   merge job applies the threshold to the combined score instead.
 * - A 6GB test runner heap instead of 8GB. The 8GB in the base config is for
 *   a dry run over the whole mutate set; a shard's chunk is a small slice of
 *   it. On a 16GB runner the parent and the TypeScript checker take up to 3GB
 *   each (NODE_OPTIONS in the workflow), and a process uses more memory than
 *   its heap: at 8GB here four shards lost their runner on 27 November 2026.
 */
export default {
  ...base,
  testRunnerNodeArgs: [
    ...base.testRunnerNodeArgs.filter(
      arg => !arg.startsWith('--max-old-space-size='),
    ),
    '--max-old-space-size=6144',
  ],
  thresholds: { ...base.thresholds, break: null },
};
