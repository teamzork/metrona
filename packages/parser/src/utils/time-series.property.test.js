/**
 * @fileoverview Property-based tests for time-series grouping
 * Feature: metrona-analytics-system, Property 3: Time-Series Grouping Accuracy
 * **Validates: Requirements 1.3**
 */

const fc = require('fast-check');
const { TimeSeriesGrouper, groupByTimePeriod } = require('./time-series');

describe('TimeSeriesGrouper Property Tests', () => {
  describe('Property 3: Time-Series Grouping Accuracy', () => {
    /**
     * Property: For any collection of log entries with timestamps, grouping by time periods 
     * (hourly, daily, monthly) should place each entry in exactly one correct time bucket 
     * based on its timestamp.
     * **Validates: Requirements 1.3**
     */
    it('should place each entry in exactly one correct time bucket', () => {
      // Generator for log entries with random timestamps
      const logEntryGenerator = fc.record({
        timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') }),
        ip: fc.tuple(
          fc.integer({ min: 1, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 })
        ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
        method: fc.constantFrom('GET', 'POST', 'HEAD'),
        path: fc.string({ minLength: 1, maxLength: 50 }).map(s => '/' + s.replace(/[^a-zA-Z0-9-_]/g, '')),
        status: fc.constantFrom(200, 404, 500),
        bytes: fc.integer({ min: 0, max: 100000 }),
        userAgent: fc.constant('Mozilla/5.0 Test')
      });

      // Generator for arrays of log entries
      const entriesGenerator = fc.array(logEntryGenerator, { minLength: 1, maxLength: 50 });

      // Generator for time periods
      const periodGenerator = fc.constantFrom('hourly', 'daily', 'monthly');

      const grouper = new TimeSeriesGrouper();

      fc.assert(
        fc.property(
          entriesGenerator,
          periodGenerator,
          (entries, period) => {
            const result = grouper.groupByTimePeriod(entries, period);
            
            // Property: Every entry should be placed in exactly one bucket
            let totalEntriesInBuckets = 0;
            result.buckets.forEach(bucket => {
              totalEntriesInBuckets += bucket.totalRequests;
            });
            
            expect(totalEntriesInBuckets).toBe(entries.length);
            
            // Property: Each bucket should have valid time boundaries
            result.buckets.forEach(bucket => {
              expect(new Date(bucket.start)).toBeInstanceOf(Date);
              expect(new Date(bucket.end)).toBeInstanceOf(Date);
              expect(new Date(bucket.start).getTime()).toBeLessThan(new Date(bucket.end).getTime());
            });
            
            // Property: Buckets should be in chronological order
            for (let i = 1; i < result.buckets.length; i++) {
              const prevBucket = result.buckets[i - 1];
              const currentBucket = result.buckets[i];
              expect(new Date(prevBucket.start).getTime()).toBeLessThanOrEqual(new Date(currentBucket.start).getTime());
            }
            
            // Property: Bucket keys should be unique
            const bucketKeys = result.buckets.map(b => b.key);
            const uniqueKeys = new Set(bucketKeys);
            expect(uniqueKeys.size).toBe(bucketKeys.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Time bucket boundaries should align with period boundaries
     */
    it('should align bucket boundaries with period boundaries', () => {
      const logEntryGenerator = fc.record({
        timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-31') }),
        ip: fc.constant('192.168.1.1'),
        method: fc.constant('GET'),
        path: fc.constant('/test'),
        status: fc.constant(200),
        bytes: fc.constant(1000),
        userAgent: fc.constant('Mozilla/5.0')
      });

      const entriesGenerator = fc.array(logEntryGenerator, { minLength: 1, maxLength: 20 });
      const grouper = new TimeSeriesGrouper();

      fc.assert(
        fc.property(entriesGenerator, (entries) => {
          // Test hourly boundaries
          const hourlyResult = grouper.groupByTimePeriod(entries, 'hourly');
          hourlyResult.buckets.forEach(bucket => {
            const start = new Date(bucket.start);
            const end = new Date(bucket.end);
            
            // Property: Hourly buckets should start at minute 0
            expect(start.getUTCMinutes()).toBe(0);
            expect(start.getUTCSeconds()).toBe(0);
            expect(start.getUTCMilliseconds()).toBe(0);
            
            // Property: Hourly buckets should span exactly 1 hour
            expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000);
          });

          // Test daily boundaries
          const dailyResult = grouper.groupByTimePeriod(entries, 'daily');
          dailyResult.buckets.forEach(bucket => {
            const start = new Date(bucket.start);
            const end = new Date(bucket.end);
            
            // Property: Daily buckets should start at midnight UTC
            expect(start.getUTCHours()).toBe(0);
            expect(start.getUTCMinutes()).toBe(0);
            expect(start.getUTCSeconds()).toBe(0);
            expect(start.getUTCMilliseconds()).toBe(0);
            
            // Property: Daily buckets should span exactly 1 day
            expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
          });

          // Test monthly boundaries
          const monthlyResult = grouper.groupByTimePeriod(entries, 'monthly');
          monthlyResult.buckets.forEach(bucket => {
            const start = new Date(bucket.start);
            
            // Property: Monthly buckets should start on day 1 at midnight UTC
            expect(start.getUTCDate()).toBe(1);
            expect(start.getUTCHours()).toBe(0);
            expect(start.getUTCMinutes()).toBe(0);
            expect(start.getUTCSeconds()).toBe(0);
            expect(start.getUTCMilliseconds()).toBe(0);
          });
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Pageview counting should be consistent and accurate
     */
    it('should count pageviews consistently and accurately', () => {
      // Generator for entries that are definitely pageviews
      const pageviewEntryGenerator = fc.record({
        timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
        ip: fc.tuple(
          fc.integer({ min: 1, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 })
        ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
        method: fc.constantFrom('GET', 'HEAD'),
        path: fc.constantFrom('/home', '/about', '/contact', '/blog/post-1'),
        status: fc.constantFrom(200, 301, 302),
        bytes: fc.integer({ min: 100, max: 10000 }),
        userAgent: fc.string({ minLength: 10, maxLength: 100 }).filter(s => s.trim().length > 0)
      });

      // Generator for entries that are NOT pageviews
      const nonPageviewEntryGenerator = fc.oneof(
        // Static assets
        fc.record({
          timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
          ip: fc.constant('192.168.1.1'),
          method: fc.constant('GET'),
          path: fc.constantFrom('/style.css', '/script.js', '/image.png', '/favicon.ico'),
          status: fc.constant(200),
          bytes: fc.integer({ min: 100, max: 10000 }),
          userAgent: fc.constant('Mozilla/5.0')
        }),
        // Non-GET methods
        fc.record({
          timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
          ip: fc.constant('192.168.1.1'),
          method: fc.constantFrom('POST', 'PUT', 'DELETE'),
          path: fc.constant('/api/data'),
          status: fc.constant(200),
          bytes: fc.integer({ min: 100, max: 10000 }),
          userAgent: fc.constant('Mozilla/5.0')
        }),
        // Error status codes
        fc.record({
          timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
          ip: fc.constant('192.168.1.1'),
          method: fc.constant('GET'),
          path: fc.constant('/missing-page'),
          status: fc.constantFrom(404, 500, 503),
          bytes: fc.integer({ min: 100, max: 10000 }),
          userAgent: fc.constant('Mozilla/5.0')
        })
      );

      const grouper = new TimeSeriesGrouper();

      fc.assert(
        fc.property(
          fc.array(pageviewEntryGenerator, { minLength: 1, maxLength: 20 }),
          fc.array(nonPageviewEntryGenerator, { minLength: 0, maxLength: 10 }),
          (pageviewEntries, nonPageviewEntries) => {
            const allEntries = [...pageviewEntries, ...nonPageviewEntries];
            
            const result = grouper.groupByTimePeriod(allEntries, 'hourly');
            
            // Property: Total pageviews should equal number of pageview entries
            const totalPageviews = result.buckets.reduce((sum, bucket) => sum + bucket.pageviews, 0);
            expect(totalPageviews).toBe(pageviewEntries.length);
            
            // Property: Total requests should equal all entries
            const totalRequests = result.buckets.reduce((sum, bucket) => sum + bucket.totalRequests, 0);
            expect(totalRequests).toBe(allEntries.length);
            
            // Property: Pageviews should never exceed total requests in any bucket
            result.buckets.forEach(bucket => {
              expect(bucket.pageviews).toBeLessThanOrEqual(bucket.totalRequests);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Unique visitor counting should be accurate
     */
    it('should count unique visitors accurately', () => {
      // Generator for entries with controlled IP/UserAgent combinations
      const visitorGenerator = fc.record({
        ip: fc.constantFrom('192.168.1.1', '192.168.1.2', '192.168.1.3'),
        userAgent: fc.constantFrom('Mozilla/5.0 Chrome', 'Mozilla/5.0 Firefox', 'Mozilla/5.0 Safari')
      });

      const entryGenerator = fc.tuple(
        fc.date({ min: new Date('2026-01-01T10:00:00Z'), max: new Date('2026-01-01T12:00:00Z') }),
        visitorGenerator
      ).map(([timestamp, visitor]) => ({
        timestamp,
        ip: visitor.ip,
        method: 'GET',
        path: '/test',
        status: 200,
        bytes: 1000,
        userAgent: visitor.userAgent
      }));

      const entriesGenerator = fc.array(entryGenerator, { minLength: 1, maxLength: 30 });
      const grouper = new TimeSeriesGrouper();

      fc.assert(
        fc.property(entriesGenerator, (entries) => {
          const result = grouper.groupByTimePeriod(entries, 'hourly');
          
          // Property: Unique visitors should never exceed total requests
          result.buckets.forEach(bucket => {
            expect(bucket.uniqueVisitors).toBeLessThanOrEqual(bucket.totalRequests);
          });
          
          // Property: If all entries have same IP+UserAgent, unique visitors should be 1 per bucket with data
          const uniqueVisitorCombos = new Set(entries.map(e => `${e.ip}:${e.userAgent}`));
          result.buckets.forEach(bucket => {
            if (bucket.totalRequests > 0) {
              expect(bucket.uniqueVisitors).toBeLessThanOrEqual(uniqueVisitorCombos.size);
            } else {
              expect(bucket.uniqueVisitors).toBe(0);
            }
          });
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Zero-fill functionality should create complete time series
     */
    it('should create complete time series with zero-fill', () => {
      const entryGenerator = fc.record({
        timestamp: fc.date({ min: new Date('2026-01-01T10:00:00Z'), max: new Date('2026-01-01T11:00:00Z') }),
        ip: fc.constant('192.168.1.1'),
        method: fc.constant('GET'),
        path: fc.constant('/test'),
        status: fc.constant(200),
        bytes: fc.constant(1000),
        userAgent: fc.constant('Mozilla/5.0')
      });

      const entriesGenerator = fc.array(entryGenerator, { minLength: 1, maxLength: 5 });
      const grouper = new TimeSeriesGrouper();

      fc.assert(
        fc.property(entriesGenerator, (entries) => {
          const startDate = new Date('2026-01-01T10:00:00Z');
          const endDate = new Date('2026-01-01T15:00:00Z'); // 5 hours span
          
          const result = grouper.generateCompleteTimeSeries(entries, 'hourly', startDate, endDate);
          
          // Property: Should have exactly 5 buckets (10-11, 11-12, 12-13, 13-14, 14-15)
          expect(result.buckets).toHaveLength(5);
          
          // Property: All buckets should exist, even if empty
          const expectedKeys = [
            '2026-01-01T10:00:00Z',
            '2026-01-01T11:00:00Z',
            '2026-01-01T12:00:00Z',
            '2026-01-01T13:00:00Z',
            '2026-01-01T14:00:00Z'
          ];
          
          const actualKeys = result.buckets.map(b => b.key);
          expect(actualKeys).toEqual(expectedKeys);
          
          // Property: Empty buckets should have zero values
          result.buckets.forEach(bucket => {
            if (bucket.totalRequests === 0) {
              expect(bucket.pageviews).toBe(0);
              expect(bucket.uniqueVisitors).toBe(0);
              expect(bucket.bytes).toBe(0);
            }
          });
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Bucket key generation should be deterministic and unique
     */
    it('should generate deterministic and unique bucket keys', () => {
      const timestampGenerator = fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') });
      const periodGenerator = fc.constantFrom('hourly', 'daily', 'monthly');
      
      const grouper = new TimeSeriesGrouper();

      fc.assert(
        fc.property(
          timestampGenerator,
          periodGenerator,
          (timestamp, period) => {
            // Property: Same timestamp and period should produce same key
            const key1 = grouper.getBucketKey(timestamp, period);
            const key2 = grouper.getBucketKey(timestamp, period);
            expect(key1).toBe(key2);
            
            // Property: Key should be a non-empty string
            expect(typeof key1).toBe('string');
            expect(key1.length).toBeGreaterThan(0);
            
            // Property: Key format should match expected patterns
            switch (period) {
              case 'hourly':
                expect(key1).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
                break;
              case 'daily':
                expect(key1).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                break;
              case 'monthly':
                expect(key1).toMatch(/^\d{4}-\d{2}$/);
                break;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});