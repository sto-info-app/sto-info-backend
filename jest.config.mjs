export default {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: String.raw`\.spec\.ts$`,
  transform: {
    [String.raw`^.+\.(t|j)s$`]: 'ts-jest',
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  collectCoverage: true,
  reporters: ['default', 'jest-junit'],
  coverageReporters: [
    'text-summary',
    'text',
    'lcov',
    'cobertura',
    'json-summary',
  ],
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    // Exclude test files
    '!**/*.spec.(t|j)s',
    '!**/*.fuzz.spec.(t|j)s',
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
    '!**/views/copy-email-templates-to-dist.ts',
    // Exclude barrel export files (index.ts files that just re-export)
    '!**/index.ts',
    // Exclude express type augmentation
    '!**/express.d.ts',
    // Exclude Jest coverage directory
    '!**/reports/**',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/reports/',
    '/config/environments/',
    '/database/migrations/',
    '/src/main.ts',
  ],
  testEnvironment: 'node',
  coverageThreshold: {
    // Global baseline - applies to all files not matching patterns below
    global: {
      statements: 99,
      branches: 98,
      functions: 99,
      lines: 99,
    },

    // Core business logic - highest standards
    './src/**/*.service.ts': {
      statements: 99,
      branches: 99,
      functions: 100,
      lines: 99,
    },

    // Shared utilities - high standards (reused across application)
    './src/shared/utilities/**/*.ts': {
      statements: 99,
      branches: 99,
      functions: 100,
      lines: 99,
    },

    // Controllers - pragmatic (thin layer, mostly routing)
    './src/**/*.controller.ts': {
      statements: 95,
      branches: 80,
      functions: 95,
      lines: 95,
    },

    // Guards and middleware - important but simpler
    './src/**/*.guard.ts': {
      statements: 98,
      branches: 98,
      functions: 100,
      lines: 98,
    },
    './src/**/*.middleware.ts': {
      statements: 98,
      branches: 98,
      functions: 100,
      lines: 98,
    },
  },
  coverageDirectory: '<rootDir>/reports/coverage',
  testPathIgnorePatterns: ['/node_modules/', '/.stryker-tmp/'],
  modulePathIgnorePatterns: ['<rootDir>/.stryker-tmp/'],
};
