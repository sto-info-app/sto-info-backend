/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
module.exports = {
  packageManager: 'npm',
  reporters: ["html", "clear-text", "progress"],
  testRunner: 'jest',
  jest: {
    projectType: 'custom',
    configFile: 'jest.config.js',
    enableFindRelatedTests: false,
  },
  mutate: [
    'src/**/*.ts',

    // Exclude tests
    '!src/**/*.spec.ts',

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
    '!src/views/copy-email-templates-to-dist.js',
    '!src/**/index.ts',
    '!src/express.d.ts',
  ],
  checkers: ['typescript'],
  coverageAnalysis: 'perTest',
  concurrency: 2,
  thresholds: {
    high: 80,
    low: 60,
    break: 0
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage'],
  tempDirName: '.stryker-tmp',
  tsconfigFile: 'tsconfig.spec.json',
};
