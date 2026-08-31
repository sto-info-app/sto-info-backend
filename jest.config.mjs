export default {
  // Jest 30 can require() ESM on Node 24.9+, but that path needs
  // vm.SourceTextModule (still behind --experimental-vm-modules). npm test
  // scripts set NODE_OPTIONS=--experimental-vm-modules so @nestjs/jwt@12
  // (ESM, no "require" export condition) loads from CommonJS specs.
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: String.raw`\.spec\.ts$`,
  transform: {
    [String.raw`^.+\.(t|j)s$`]: ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
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
    global: {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
  coverageDirectory: '<rootDir>/reports/coverage',
  testPathIgnorePatterns: ['/node_modules/'],
  modulePathIgnorePatterns: [],
};
