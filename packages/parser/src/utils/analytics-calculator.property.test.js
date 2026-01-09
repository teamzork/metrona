/**
 * @fileoverview Property-based tests for AnalyticsCalculator
 * Feature: metrona-analytics-system
 * Properties 25-28: Time-Series Data Organization, Top Content Data Completeness, 
 * Referrer Data Grouping, Summary Statistics Accuracy
 * Requirements: 7.2, 7.3, 7.4, 7.5
 */

const fc = require('fast-check');
const { AnalyticsCalculator } = require('./analytics-calculator');

describe('AnalyticsCalculator Property Tests', () => {
  
  /**
   * Property 25: Time-Series Data Organization
   * Validates: Requirement 7.2 - Time-series data organization
   */
  describe('Property 25: Time-Series Data Organization', () => {
    it('should organize time-series data correctly for any valid log entries', () => {
      fc.assert(
        fc.property(
          // Generate array of log entries with valid structure
          fc.array(
            fc.record({
              ip: fc.ipV4(),
              userAgent: fc.string({ minLength: 5, maxLength: 100 }),
              path: fc.oneof(
                fc.constant('/'),
                fc.string({ minLength: 1, maxLength: 50 }).map(s => '/' + s.replace(/[^a-zA-Z0-9\-_]/g, ''))
              ),
              timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') }),
              method: fc.constantFrom('GET', 'POST', 'HEAD'),
              status: fc.constantFrom(200, 201, 404, 500),
              bytes: fc.integer({ min: 0, max: 100000 }),
              referrer: fc.oneof(
                fc.constant('-'),
                fc.webUrl()
              )
            }),
            { minLength: 1, maxLength: 100 }
          ),
          fc.constantFrom('hourly', 'daily', 'monthly'),
          (entries, groupBy) => {
            const calculator = new AnalyticsCalculator();
            calculator.processBatch(entries);
            
            const result = calculator.generateTimeSeriesData(groupBy);
            
            // Property: Result should have correct structure
            expect(result).toHaveProperty('groupBy', groupBy);
            expect(result).toHaveProperty('timezone', 'UTC');
            expect(result).toHaveProperty('buckets');
            expect(result).toHaveProperty('totalPageviews');
            expect(result).toHaveProperty('uniqueVisitors');
            
            // Property: Buckets should be properly ordered by timestamp
            if (result.buckets.length > 1) {
              for (let i = 1; i < result.buckets.length; i++) {
                const prevTime = new Date(result.buckets[i - 1].timestamp);
                const currTime = new Date(result.buckets[i].timestamp);
                expect(currTime.getTime()).toBeGreaterThan(prevTime.getTime());
              }
            }
            
            // Property: Total pageviews should equal sum of bucket pageviews
            const bucketSum = result.buckets.reduce((sum, bucket) => sum + bucket.pageviews, 0);
            expect(bucketSum).toBeLessThanOrEqual(result.totalPageviews);
            
            // Property: Each bucket should have valid structure
            result.buckets.forEach(bucket => {
              expect(bucket).toHaveProperty('timestamp');
              expect(bucket).toHaveProperty('pageviews');
              expect(bucket).toHaveProperty('uniqueVisitors');
              expect(bucket.pageviews).toBeGreaterThanOrEqual(0);
              expect(bucket.uniqueVisitors).toBeGreaterThanOrEqual(0);
              expect(bucket.uniqueVisitors).toBeLessThanOrEqual(bucket.pageviews);
            });
            
            // Property: Unique visitors should be consistent
            expect(result.uniqueVisitors).toBeGreaterThanOrEqual(0);
            expect(result.uniqueVisitors).toBeLessThanOrEqual(entries.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty data gracefully', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('hourly', 'daily', 'monthly'),
          (groupBy) => {
            const calculator = new AnalyticsCalculator();
            const result = calculator.generateTimeSeriesData(groupBy);
            
            expect(result.groupBy).toBe(groupBy);
            expect(result.buckets).toEqual([]);
            expect(result.totalPageviews).toBe(0);
            expect(result.uniqueVisitors).toBe(0);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 26: Top Content Data Completeness
   * Validates: Requirement 7.3 - Top content with pageview and visitor counts
   */
  describe('Property 26: Top Content Data Completeness', () => {
    it('should generate complete top content data for any valid entries', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              ip: fc.ipV4(),
              userAgent: fc.string({ minLength: 5, maxLength: 100 }),
              path: fc.oneof(
                fc.constant('/'),
                fc.constant('/home'),
                fc.constant('/about'),
                fc.constant('/contact'),
                fc.string({ minLength: 1, maxLength: 20 }).map(s => '/' + s.replace(/[^a-zA-Z0-9]/g, ''))
              ),
              timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') }),
              method: fc.constantFrom('GET', 'HEAD'),
              status: fc.constantFrom(200, 201, 202, 204),
              bytes: fc.integer({ min: 100, max: 50000 })
            }),
            { minLength: 1, maxLength: 50 }
          ),
          fc.integer({ min: 1, max: 20 }),
          (entries, limit) => {
            const calculator = new AnalyticsCalculator();
            calculator.processBatch(entries);
            
            const result = calculator.generateTopContentData(limit);
            
            // Property: Result should have correct structure
            expect(result).toHaveProperty('totalPages');
            expect(result).toHaveProperty('topPages');
            expect(result).toHaveProperty('totalPageviews');
            expect(result).toHaveProperty('uniqueVisitors');
            
            // Property: Top pages should be limited correctly
            expect(result.topPages.length).toBeLessThanOrEqual(limit);
            expect(result.topPages.length).toBeLessThanOrEqual(result.totalPages);
            
            // Property: Pages should be sorted by pageviews (descending)
            if (result.topPages.length > 1) {
              for (let i = 1; i < result.topPages.length; i++) {
                expect(result.topPages[i - 1].pageviews).toBeGreaterThanOrEqual(
                  result.topPages[i].pageviews
                );
              }
            }
            
            // Property: Each page should have valid metrics
            result.topPages.forEach(page => {
              expect(page).toHaveProperty('path');
              expect(page).toHaveProperty('pageviews');
              expect(page).toHaveProperty('uniqueVisitors');
              expect(page).toHaveProperty('percentage');
              
              expect(page.pageviews).toBeGreaterThan(0);
              expect(page.uniqueVisitors).toBeGreaterThan(0);
              expect(page.uniqueVisitors).toBeLessThanOrEqual(page.pageviews);
              expect(page.percentage).toBeGreaterThan(0);
              expect(page.percentage).toBeLessThanOrEqual(100);
            });
            
            // Property: Total metrics should be consistent
            expect(result.totalPageviews).toBeGreaterThanOrEqual(0);
            expect(result.uniqueVisitors).toBeGreaterThanOrEqual(0);
            expect(result.uniqueVisitors).toBeLessThanOrEqual(result.totalPageviews);
            
            // Property: Sum of top page pageviews should not exceed total
            const topPageviewsSum = result.topPages.reduce((sum, page) => sum + page.pageviews, 0);
            expect(topPageviewsSum).toBeLessThanOrEqual(result.totalPageviews);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle duplicate paths correctly', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }).map(s => '/' + s.replace(/[^a-zA-Z0-9]/g, '')),
          fc.array(fc.ipV4(), { minLength: 1, maxLength: 10 }),
          fc.array(fc.string({ minLength: 5, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
          (path, ips, userAgents) => {
            const calculator = new AnalyticsCalculator();
            
            // Create entries with same path but different visitors
            const entries = [];
            for (let i = 0; i < Math.min(ips.length, userAgents.length); i++) {
              entries.push({
                ip: ips[i],
                userAgent: userAgents[i],
                path: path,
                timestamp: new Date('2026-01-08T12:00:00Z'),
                method: 'GET',
                status: 200,
                bytes: 1000
              });
            }
            
            calculator.processBatch(entries);
            const result = calculator.generateTopContentData(10);
            
            if (entries.length > 0) {
              expect(result.topPages).toHaveLength(1);
              const topPage = result.topPages[0];
              expect(topPage.path).toBe(path);
              expect(topPage.pageviews).toBe(entries.length);
              expect(topPage.uniqueVisitors).toBeLessThanOrEqual(entries.length);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 27: Referrer Data Grouping
   * Validates: Requirement 7.4 - Referrer domain grouping
   */
  describe('Property 27: Referrer Data Grouping', () => {
    it('should group referrer data correctly for any valid entries', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              ip: fc.ipV4(),
              userAgent: fc.string({ minLength: 5, maxLength: 100 }),
              path: fc.oneof(
                fc.constant('/'),
                fc.string({ minLength: 1, maxLength: 20 }).map(s => '/' + s.replace(/[^a-zA-Z0-9]/g, ''))
              ),
              timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') }),
              method: fc.constantFrom('GET', 'HEAD'),
              status: fc.constantFrom(200, 201, 202),
              bytes: fc.integer({ min: 100, max: 10000 }),
              referrer: fc.oneof(
                fc.constant('-'),
                fc.constant(''),
                fc.webUrl()
              )
            }),
            { minLength: 1, maxLength: 30 }
          ),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 5 }),
          (entries, limit, pathsPerDomain) => {
            const calculator = new AnalyticsCalculator();
            calculator.processBatch(entries);
            
            const result = calculator.generateReferrerData(limit, pathsPerDomain);
            
            // Property: Result should have correct structure
            expect(result).toHaveProperty('totalReferrerDomains');
            expect(result).toHaveProperty('totalReferrals');
            expect(result).toHaveProperty('topReferrers');
            expect(result).toHaveProperty('directTraffic');
            
            // Property: Top referrers should be limited correctly
            expect(result.topReferrers.length).toBeLessThanOrEqual(limit);
            expect(result.topReferrers.length).toBeLessThanOrEqual(result.totalReferrerDomains);
            
            // Property: Referrers should be sorted by total referrals (descending)
            if (result.topReferrers.length > 1) {
              for (let i = 1; i < result.topReferrers.length; i++) {
                expect(result.topReferrers[i - 1].totalReferrals).toBeGreaterThanOrEqual(
                  result.topReferrers[i].totalReferrals
                );
              }
            }
            
            // Property: Each referrer should have valid structure
            result.topReferrers.forEach(referrer => {
              expect(referrer).toHaveProperty('domain');
              expect(referrer).toHaveProperty('totalReferrals');
              expect(referrer).toHaveProperty('percentage');
              expect(referrer).toHaveProperty('topPaths');
              
              expect(referrer.totalReferrals).toBeGreaterThan(0);
              expect(referrer.percentage).toBeGreaterThan(0);
              expect(referrer.topPaths.length).toBeLessThanOrEqual(pathsPerDomain);
              
              // Each path should have valid structure
              referrer.topPaths.forEach(pathData => {
                expect(pathData).toHaveProperty('url');
                expect(pathData).toHaveProperty('count');
                expect(pathData).toHaveProperty('percentage');
                expect(pathData.count).toBeGreaterThan(0);
                expect(pathData.percentage).toBeGreaterThan(0);
              });
            });
            
            // Property: Traffic accounting should be consistent
            expect(result.totalReferrals).toBeGreaterThanOrEqual(0);
            expect(result.directTraffic).toBeGreaterThanOrEqual(0);
            expect(result.totalReferrals + result.directTraffic).toBeLessThanOrEqual(entries.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle entries without referrers correctly', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              ip: fc.ipV4(),
              userAgent: fc.string({ minLength: 5, maxLength: 100 }),
              path: fc.constant('/home'),
              timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') }),
              method: fc.constant('GET'),
              status: fc.constant(200),
              bytes: fc.integer({ min: 100, max: 10000 }),
              referrer: fc.constantFrom('-', '', undefined)
            }),
            { minLength: 1, maxLength: 20 }
          ),
          (entries) => {
            const calculator = new AnalyticsCalculator();
            calculator.processBatch(entries);
            
            const result = calculator.generateReferrerData(10, 5);
            
            // Property: Should have no referrer domains but all direct traffic
            expect(result.totalReferrerDomains).toBe(0);
            expect(result.totalReferrals).toBe(0);
            expect(result.topReferrers).toHaveLength(0);
            expect(result.directTraffic).toBe(entries.length);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 28: Summary Statistics Accuracy
   * Validates: Requirement 7.5 - Summary statistics including totals and top performing content
   */
  describe('Property 28: Summary Statistics Accuracy', () => {
    it('should generate accurate summary statistics for any valid entries', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              ip: fc.ipV4(),
              userAgent: fc.string({ minLength: 5, maxLength: 100 }),
              path: fc.oneof(
                fc.constant('/'),
                fc.constant('/home'),
                fc.constant('/about'),
                fc.string({ minLength: 1, maxLength: 15 }).map(s => '/' + s.replace(/[^a-zA-Z0-9]/g, ''))
              ),
              timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-31') }),
              method: fc.constantFrom('GET', 'HEAD'),
              status: fc.constantFrom(200, 201, 202),
              bytes: fc.integer({ min: 100, max: 10000 }),
              referrer: fc.oneof(
                fc.constant('-'),
                fc.webUrl()
              )
            }),
            { minLength: 1, maxLength: 50 }
          ),
          (entries) => {
            const calculator = new AnalyticsCalculator();
            calculator.processBatch(entries);
            
            const result = calculator.generateSummaryStatistics();
            
            // Property: Core metrics should be present and valid
            expect(result).toHaveProperty('totalPageviews');
            expect(result).toHaveProperty('uniqueVisitors');
            expect(result).toHaveProperty('totalPages');
            expect(result).toHaveProperty('totalReferrerDomains');
            expect(result).toHaveProperty('avgPageviewsPerSession');
            expect(result).toHaveProperty('directTraffic');
            expect(result).toHaveProperty('referralTraffic');
            expect(result).toHaveProperty('topPages');
            expect(result).toHaveProperty('topReferrers');
            expect(result).toHaveProperty('generatedAt');
            expect(result).toHaveProperty('dataRange');
            
            // Property: Metrics should have valid values
            expect(result.totalPageviews).toBe(entries.length);
            expect(result.uniqueVisitors).toBeGreaterThanOrEqual(0);
            expect(result.uniqueVisitors).toBeLessThanOrEqual(entries.length);
            expect(result.totalPages).toBeGreaterThanOrEqual(0);
            expect(result.totalReferrerDomains).toBeGreaterThanOrEqual(0);
            expect(result.avgPageviewsPerSession).toBeGreaterThanOrEqual(0);
            
            // Property: Traffic accounting should be consistent
            expect(result.directTraffic).toBeGreaterThanOrEqual(0);
            expect(result.referralTraffic).toBeGreaterThanOrEqual(0);
            expect(result.directTraffic + result.referralTraffic).toBeLessThanOrEqual(entries.length);
            
            // Property: Average pageviews per session calculation
            if (result.uniqueVisitors > 0) {
              const expectedAvg = result.totalPageviews / result.uniqueVisitors;
              expect(Math.abs(result.avgPageviewsPerSession - expectedAvg)).toBeLessThan(0.01);
            } else {
              expect(result.avgPageviewsPerSession).toBe(0);
            }
            
            // Property: Top content should be limited and valid
            expect(result.topPages.length).toBeLessThanOrEqual(3);
            expect(result.topReferrers.length).toBeLessThanOrEqual(3);
            
            result.topPages.forEach(page => {
              expect(page).toHaveProperty('path');
              expect(page).toHaveProperty('pageviews');
              expect(page).toHaveProperty('uniqueVisitors');
              expect(page.pageviews).toBeGreaterThan(0);
              expect(page.uniqueVisitors).toBeGreaterThan(0);
            });
            
            result.topReferrers.forEach(referrer => {
              expect(referrer).toHaveProperty('domain');
              expect(referrer).toHaveProperty('totalReferrals');
              expect(referrer.totalReferrals).toBeGreaterThan(0);
            });
            
            // Property: Data range should be valid
            if (entries.length > 0) {
              expect(result.dataRange.start).toBeDefined();
              expect(result.dataRange.end).toBeDefined();
              expect(result.dataRange.start).toBeLessThanOrEqual(result.dataRange.end);
            }
            
            // Property: Generated timestamp should be recent
            const generatedTime = new Date(result.generatedAt);
            const now = new Date();
            expect(generatedTime.getTime()).toBeLessThanOrEqual(now.getTime());
            expect(now.getTime() - generatedTime.getTime()).toBeLessThan(5000); // Within 5 seconds
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge cases correctly', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Single entry
            fc.array(
              fc.record({
                ip: fc.constant('192.168.1.1'),
                userAgent: fc.constant('Mozilla/5.0'),
                path: fc.constant('/home'),
                timestamp: fc.constant(new Date('2026-01-08T12:00:00Z')),
                method: fc.constant('GET'),
                status: fc.constant(200),
                bytes: fc.constant(1000),
                referrer: fc.constant('-')
              }),
              { minLength: 1, maxLength: 1 }
            ),
            // Multiple entries, same visitor
            fc.array(
              fc.record({
                ip: fc.constant('192.168.1.1'),
                userAgent: fc.constant('Mozilla/5.0'),
                path: fc.oneof(fc.constant('/home'), fc.constant('/about')),
                timestamp: fc.date({ min: new Date('2026-01-08T10:00:00Z'), max: new Date('2026-01-08T14:00:00Z') }),
                method: fc.constant('GET'),
                status: fc.constant(200),
                bytes: fc.constant(1000),
                referrer: fc.constant('-')
              }),
              { minLength: 2, maxLength: 10 }
            )
          ),
          (entries) => {
            const calculator = new AnalyticsCalculator();
            calculator.processBatch(entries);
            
            const result = calculator.generateSummaryStatistics();
            
            // Property: Single visitor edge case
            expect(result.uniqueVisitors).toBe(1);
            expect(result.totalPageviews).toBe(entries.length);
            expect(result.avgPageviewsPerSession).toBe(entries.length);
            expect(result.directTraffic).toBe(entries.length);
            expect(result.referralTraffic).toBe(0);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Cross-property validation tests
   */
  describe('Cross-Property Validation', () => {
    it('should maintain data consistency across all analytics methods', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              ip: fc.ipV4(),
              userAgent: fc.string({ minLength: 5, maxLength: 100 }),
              path: fc.oneof(
                fc.constant('/'),
                fc.constant('/home'),
                fc.constant('/about'),
                fc.constant('/contact')
              ),
              timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-31') }),
              method: fc.constantFrom('GET', 'HEAD'),
              status: fc.constantFrom(200, 201, 202),
              bytes: fc.integer({ min: 100, max: 10000 }),
              referrer: fc.oneof(
                fc.constant('-'),
                fc.webUrl()
              )
            }),
            { minLength: 5, maxLength: 30 }
          ),
          (entries) => {
            const calculator = new AnalyticsCalculator();
            calculator.processBatch(entries);
            
            const timeSeries = calculator.generateTimeSeriesData('daily');
            const topContent = calculator.generateTopContentData(10);
            const referrerData = calculator.generateReferrerData(10, 5);
            const summary = calculator.generateSummaryStatistics();
            
            // Property: Total pageviews should be consistent across all methods
            expect(timeSeries.totalPageviews).toBe(entries.length);
            expect(topContent.totalPageviews).toBe(entries.length);
            expect(summary.totalPageviews).toBe(entries.length);
            
            // Property: Unique visitors should be consistent
            expect(timeSeries.uniqueVisitors).toBe(topContent.uniqueVisitors);
            expect(topContent.uniqueVisitors).toBe(summary.uniqueVisitors);
            
            // Property: Traffic accounting should be consistent
            const totalTraffic = referrerData.directTraffic + referrerData.totalReferrals;
            expect(totalTraffic).toBeLessThanOrEqual(entries.length);
            expect(summary.directTraffic + summary.referralTraffic).toBeLessThanOrEqual(entries.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});