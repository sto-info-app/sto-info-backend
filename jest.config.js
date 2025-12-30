module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: String.raw`.*\.spec\.ts$`,
  transform: {
    [String.raw`^.+\.(t|j)s$`]: 'ts-jest',
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
  },
  collectCoverage: true,
  coverageReporters: ['text-summary', 'text', 'lcov', 'cobertura'],
  collectCoverageFrom: [
    '**/*.(t|j)s',
    // Exclude test files
    '!**/*.spec.(t|j)s',
    // Exclude NestJS module files
    '!**/*.module.(t|j)s',
    // Exclude main entry point
    '!**/main.(t|j)s',
    // Exclude type definitions
    '!**/*.d.ts',
    // Exclude DTOs, entities, interfaces, enums, constants
    '!**/*.dto.(t|j)s',
    '!**/*.entity.(t|j)s',
    '!**/*.entities.(t|j)s',
    '!**/*.interface.(t|j)s',
    '!**/*.interfaces.(t|j)s',
    '!**/*.enum.(t|j)s',
    '!**/*.constant.(t|j)s',
    '!**/*.constants.(t|j)s',
    // Exclude database migrations
    '!**/database/migrations/**',
    // Exclude build scripts
    '!**/views/**/*.js',
    '!**/views/copy-email-templates-to-dist.js',
    // Exclude barrel export files (index.ts files that just re-export)
    '!**/index.ts',
    // Exclude express type augmentation
    '!**/express.d.ts',
    // Exclude Jest coverage directory
    '!**/coverage/**',
  ],
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
  coverageDirectory: 'coverage',
};
