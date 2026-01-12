/**
 * Jest setup file for Metrona Analytics System
 */

// Increase timeout for property-based tests
jest.setTimeout(30000);

// Mock console methods in tests to reduce noise
global.console = {
  ...console,
  // Uncomment to suppress console output in tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Global test cleanup to prevent hanging
afterEach(() => {
  // Clear all timers
  jest.clearAllTimers();
  
  // Clear all mocks
  jest.clearAllMocks();
});

// Global test teardown
afterAll(() => {
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
});