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
    '^@metrona/shared$': '<rootDir>/packages/shared/src/index.js',
    '^@metrona/parser$': '<rootDir>/packages/parser/src/index.js',
    '^@metrona/scheduler$': '<rootDir>/packages/scheduler/src/index.js',
    '^@metrona/cli$': '<rootDir>/packages/cli/src/index.js',
    '^@metrona/dashboard$': '<rootDir>/packages/dashboard/src/index.js',
    '^@metrona/components$': '<rootDir>/packages/components/src/index.js'
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  
  // Timeout for tests (important for property-based tests)
  testTimeout: 30000,
  
  // Force exit to prevent hanging
  forceExit: true,
  
  // Detect open handles that might cause hanging
  detectOpenHandles: true,
  
  // Verbose output
  verbose: true,
  
  // Max workers to prevent resource exhaustion
  maxWorkers: 2,
  
  // Bail after first test failure to prevent hanging on subsequent tests
  bail: false,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Reset modules between tests
  resetModules: true
};