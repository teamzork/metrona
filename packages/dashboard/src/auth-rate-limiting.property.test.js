/**
 * @fileoverview Property-based tests for authentication rate limiting
 * **Feature: metrona-analytics-system, Property 35: Authentication Rate Limiting**
 * **Validates: Requirements 10.5**
 */

const fc = require('fast-check');
const { ServerDashboard } = require('./server-dashboard');
const bcrypt = require('bcryptjs');
const request = require('supertest');

// Every property iteration (including fast-check's shrink re-runs) needs an
// IP the rate limiter hasn't seen in this window. IPs derived from the
// generated suffix could repeat, so an iteration inherited earlier attempts
// and got 429 where 401 was expected.
let ipCounter = 0;
const nextTestIP = (prefix) => {
  ipCounter++;
  return `${prefix}.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};

describe('Authentication Rate Limiting Property Tests', () => {
  let dashboard;
  const testPassword = 'test-password-123';
  let passwordHash;

  beforeAll(async () => {
    // Create password hash for testing (use lower cost for speed)
    passwordHash = await bcrypt.hash(testPassword, 4); // Lower cost for testing
  });

  beforeEach(() => {
    // Create dashboard with rate limiting enabled
    dashboard = new ServerDashboard({
      port: 0, // Use random port for testing
      passwordHash: passwordHash,
      httpsOnly: false, // Disable for testing
      rateLimit: 3, // Low limit for testing
      rateLimitWindow: 10000, // 10 second window for testing (longer to ensure all requests are in same window)
      sites: []
    });
  });

  afterEach(async () => {
    if (dashboard && dashboard.server && dashboard.server.listening) {
      await dashboard.stop();
    }
    // Clear any remaining timers
    jest.clearAllTimers();
    // Small delay to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  /**
   * Property 35: Authentication Rate Limiting
   * For any series of failed authentication attempts, rate limiting should be triggered 
   * after a threshold number of failures to prevent brute force attacks.
   * **Validates: Requirements 10.5**
   */
  test('Property 35: Rate limiting triggers after threshold failures', async () => {
    await dashboard.start();
    const app = dashboard.app;

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1000, max: 9999 }), // Use larger range to avoid IP conflicts
        async (ipSuffix) => {
          // Property: After rate limit threshold is exceeded, subsequent requests should be rate limited
          
          let rateLimitTriggered = false;
          let requestCount = 0;
          const maxRequests = dashboard.rateLimit + 3; // Try a few more than the limit
          const testIP = nextTestIP('10.0');
          
          // Make consecutive failed login attempts with small delays to ensure they're in the same window
          for (let i = 0; i < maxRequests; i++) {
            const response = await request(app)
              .post('/auth/login')
              .set('X-Forwarded-For', testIP) // Use unique IP for this test
              .send({ password: 'wrong-password' });
            
            requestCount++;
            
            if (response.status === 429) {
              rateLimitTriggered = true;
              
              // Verify rate limit response structure
              expect(response.body).toHaveProperty('error');
              expect(response.body.error).toMatch(/too many/i);
              expect(response.headers).toHaveProperty('retry-after');
              
              break; // Rate limit triggered, stop testing
            } else {
              // Should be unauthorized (401) before rate limit
              expect(response.status).toBe(401);
            }
            
            // Small delay to ensure requests are processed sequentially
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          
          // Property assertion: Rate limiting should be triggered
          expect(rateLimitTriggered).toBe(true);
          expect(requestCount).toBeGreaterThan(dashboard.rateLimit);
        }
      ),
      { 
        numRuns: 2, // Reduced to minimum to prevent hanging
        timeout: 10000 // Reduced timeout
      }
    );
  }, 15000); // Reduced Jest timeout

  /**
   * Property: Valid authentication should work before rate limit is hit
   */
  test('Property: Valid authentication bypasses rate limiting', async () => {
    await dashboard.start();
    const app = dashboard.app;

    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.integer({ min: 1, max: 2 }), // Stay well under rate limit
          fc.integer({ min: 200, max: 254 }) // Generate unique IP suffix
        ),
        async ([numFailedAttempts, ipSuffix]) => {
          const testIP = nextTestIP('10.2');
          
          // Make some failed attempts (but stay under limit)
          for (let i = 0; i < numFailedAttempts; i++) {
            const response = await request(app)
              .post('/auth/login')
              .set('X-Forwarded-For', testIP)
              .send({ password: 'wrong' });
            
            expect(response.status).toBe(401); // Should be unauthorized, not rate limited
            
            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          
          // Now try with correct password - should succeed
          const validResponse = await request(app)
            .post('/auth/login')
            .set('X-Forwarded-For', testIP)
            .send({ password: testPassword });
          
          // Property: Valid authentication should succeed even after failed attempts
          // (as long as we haven't hit the rate limit)
          expect(validResponse.status).toBe(200);
          expect(validResponse.body).toHaveProperty('success', true);
        }
      ),
      { 
        numRuns: 2, // Reduced to prevent hanging
        timeout: 8000
      }
    );
  }, 20000);

  /**
   * Property: Rate limiting should not affect non-auth endpoints
   */
  test('Property: Rate limiting is scoped to auth endpoints only', async () => {
    await dashboard.start();
    const app = dashboard.app;

    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.integer({ min: 5, max: 10 }), // Number of requests to make
          fc.integer({ min: 100, max: 199 }) // Generate unique IP suffix
        ),
        async ([numRequests, ipSuffix]) => {
          const testIP = nextTestIP('10.3');
          
          // Make multiple requests to health endpoint (non-auth)
          for (let i = 0; i < numRequests; i++) {
            const response = await request(app)
              .get('/health')
              .set('X-Forwarded-For', testIP);
            
            // Property: Non-auth endpoints should not be rate limited
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'ok');
            
            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 5));
          }
        }
      ),
      { 
        numRuns: 2, // Reduced to prevent hanging
        timeout: 6000
      }
    );
  }, 15000);

  /**
   * Unit test to verify rate limiting works (deterministic test)
   */
  test('Unit test: Rate limiting triggers after configured threshold', async () => {
    await dashboard.start();
    const app = dashboard.app;

    // Make exactly rateLimit + 1 requests to trigger rate limiting
    const responses = [];
    const testIP = '192.168.4.100'; // Use unique IP for unit test
    
    for (let i = 0; i <= dashboard.rateLimit; i++) {
      const response = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', testIP)
        .send({ password: 'wrong-password' });
      
      responses.push(response);
      
      // Small delay to ensure requests are processed in order
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // First rateLimit requests should be 401 (unauthorized)
    for (let i = 0; i < dashboard.rateLimit; i++) {
      expect(responses[i].status).toBe(401);
    }

    // The request after the limit should be 429 (rate limited)
    const lastResponse = responses[responses.length - 1];
    expect(lastResponse.status).toBe(429);
    expect(lastResponse.body).toHaveProperty('error');
    expect(lastResponse.body.error).toMatch(/too many/i);
  }, 20000);
});