module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '<rootDir>/packages/*/src/**/*.test.js',
    '<rootDir>/packages/*/src/**/*.spec.js'
  ],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'packages/*/src/**/*.js',
    '!packages/*/src/**/*.test.js',
    '!packages/*/src/**/*.spec.js'
  ],
  
  // Module path mapping for workspace packages
  moduleNameMapper: {
    '^@analytics-system/shared$': '<rootDir>/packages/shared/src/index.js',
    '^@analytics-system/parser$': '<rootDir>/packages/parser/src/index.js',
    '^@analytics-system/scheduler$': '<rootDir>/packages/scheduler/src/index.js',
    '^@analytics-system/cli$': '<rootDir>/packages/cli/src/index.js',
    '^@analytics-system/dashboard$': '<rootDir>/packages/dashboard/src/index.js',
    '^@analytics-system/components$': '<rootDir>/packages/components/src/index.js'
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  
  // Timeout for tests (important for property-based tests)
  testTimeout: 30000,
  
  // Verbose output
  verbose: true
};