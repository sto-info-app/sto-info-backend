/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'jest',
  // --max-old-space-size raises the test runner child process's heap
  // ceiling. Jest retains full AggregatedResult data (titles, assertion
  // messages, mock call data) for every test executed for the lifetime of
  // the process, which grows steadily across a long run regardless of
  // garbage collection — confirmed by profiling with --logHeapUsage and
  // --expose-gc, where heap climbed from ~450MB to ~3.3GB across a single
  // run with no plateau. The default ceiling is too low for that on a
  // GitHub Actions runner; see maxTestRunnerReuse below for the other half
  // of the fix.
  testRunnerNodeArgs: [
    '--experimental-vm-modules',
    '--max-old-space-size=4096',
  ],
  jest: {
    projectType: 'custom',
    configFile: 'jest.config.mjs',
    enableFindRelatedTests: true,
  },
  mutate: [
    'src/**/*.ts',

    // Exclude tests
    '!src/**/*.spec.ts',
    '!src/**/*.fuzz.spec.ts',

    // Keep these aligned with jest.config.js collectCoverageFrom excludes
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/**/*.d.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.entity.ts',
    '!src/**/*.entities.ts',
    '!src/**/*.interface.ts',
    '!src/**/*.interfaces.ts',
    '!src/**/*.enum.ts',
    '!src/**/*.constant.ts',
    '!src/**/*.constants.ts',
    '!src/database/migrations/**',
    '!src/views/**/*.js',
    '!src/views/copy-email-templates-to-dist.ts',
    '!src/**/index.ts',
    '!src/express.d.ts',
  ],
  checkers: ['typescript'],
  coverageAnalysis: 'perTest',
  concurrency: 2,
  // Static mutants force a full reload + full test run per mutant. Stryker
  // measured these at 1% of mutants but 72% of run time on this project.
  ignoreStatic: true,
  // Recycle the worker well before the accumulated Jest reporting data
  // (see testRunnerNodeArgs above) can grow large enough to OOM it. The
  // original OOM warnings kept recurring roughly every 4 minutes, faster
  // than 100 reuses were ever reached, so that ceiling was never actually
  // being hit before the process crashed.
  maxTestRunnerReuse: 25,
  thresholds: {
    high: 80,
    low: 60,
    break: 0,
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage'],
  tempDirName: '.stryker-tmp',
  tsconfigFile: 'tsconfig.spec.json',
};
