/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'jest',
  testRunnerNodeArgs: ['--experimental-vm-modules'],
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
  // Test runner workers were repeatedly OOMing on long runs (see
  // test/setup.ts for the underlying TestingModule leak fix). Recycling
  // workers periodically bounds the damage from any leak we haven't caught.
  maxTestRunnerReuse: 100,
  thresholds: {
    high: 80,
    low: 60,
    break: 0,
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage'],
  tempDirName: '.stryker-tmp',
  tsconfigFile: 'tsconfig.spec.json',
};
