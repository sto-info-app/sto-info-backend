/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'jest',
  // Jest retains full AggregatedResult data (titles, assertion messages,
  // mock call data) for every test it has ever run, for the lifetime of the
  // process, so a test runner worker's heap only ever grows. Measured
  // locally: a worker went from 111MB to 2.8GB over 18 mutant runs, roughly
  // 150MB per run with no plateau.
  //
  // Note that raising --max-old-space-size on its own buys nothing on a
  // 16GB GitHub Actions runner: Node already defaults its heap ceiling to
  // ~4.3GB there, so the previous '--max-old-space-size=4096' was slightly
  // *below* the default and had no effect. The ceiling is set explicitly
  // here only to bound the worst case across `concurrency` workers
  // (4 x 3GB = 12GB of the runner's 16GB); maxTestRunnerReuse below is what
  // actually keeps a worker from reaching it.
  testRunnerNodeArgs: [
    '--experimental-vm-modules',
    '--max-old-space-size=3072',
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
  // With a checker configured Stryker splits this budget: ceil(n / 2)
  // checker processes and floor(n / 2) test runners, handing the checker
  // tokens back as extra test runners once type checking finishes. At the
  // previous value of 2 that meant a single test runner for the whole
  // checking phase, leaving half of a 4-vCPU runner idle. 4 matches the
  // vCPU count of a GitHub-hosted ubuntu-latest runner.
  concurrency: 4,
  // Static mutants force a full reload + full test run per mutant. Stryker
  // measured these at 1% of mutants but 72% of run time on this project.
  ignoreStatic: true,
  // Recycle the worker before the growth described in testRunnerNodeArgs
  // above can reach the heap ceiling. At ~150MB per mutant run a worker
  // hits ~4GB somewhere around run 25, which is why the previous ceiling of
  // 25 never won the race — the process died at almost exactly the point it
  // was due to be recycled. 8 keeps the peak near 1.5GB.
  maxTestRunnerReuse: 8,
  thresholds: {
    high: 80,
    low: 60,
    break: 0,
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage'],
  tempDirName: '.stryker-tmp',
  tsconfigFile: 'tsconfig.spec.json',
};
