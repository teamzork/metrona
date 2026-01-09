/**
 * @fileoverview Unit tests for AnalyticsCalculator
 * Feature: metrona-analytics-system, Requirements 7.2, 7.3, 7.4, 7.5
 */

const { AnalyticsCalculator, createAnalyticsCalculator, extractDomain } = require('./analytics-calculator');

describe('AnalyticsCalculator', () => {
  let calculator;

  beforeEach(() => {
    calculator = new AnalyticsCalculator({
      salt: 'test-salt',
      timezone: 'UTC'
    });
  });

  describe('constructor', () => {
    it('should create calculator with default options', () => {
      const calc = new AnalyticsCalculator();
      
      expect(calc.timezone).toBe('UTC');
      expect(calc.salt).toBe('');
      expect(calc.processedEntries).toEqual([]);
      expect(calc.uniqueVisitors.size).toBe(0);
    });

    it('should create calculator with custom options', () => {
      const calc = new AnalyticsCalculator({
        timezone: 'America/New_York',
        salt: 'custom-salt'
      });
      
      expect(calc.timezone).toBe('America/New_York');
      expect(calc.salt).toBe('custom-salt');
    });
  });

  describe('processEntry', () => {
    it('should process valid log entry', () => {
      const entry = {
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        path: '/home',
        timestamp: '2026-01-08T12:00:00Z',
        referrer: 'https://google.com'
      };

      calculator.processEntry(entry);

      expect(calculator.processedEntries).toHaveLength(1);
      expect(calculator.uniqueVisitors.size).toBe(1);
      expect(calculator.pageviews.get('/home')).toBe(1);
      expect(calculator.referrers.has('google.com')).toBe(true);
    });

    it('should skip invalid entries', () => {
      const invalidEntries = [
        null,
        undefined,
        {},
        { ip: '192.168.1.1' }, // missing required fields
        { userAgent: 'Mozilla/5.0' },
        { path: '/home' },
        { timestamp: '2026-01-08T12:00:00Z' }
      ];

      invalidEntries.forEach(entry => {
        calculator.processEntry(entry);
      });

      expect(calculator.processedEntries).toHaveLength(0);
      expect(calculator.uniqueVisitors.size).toBe(0);
    });

    it('should handle entries without referrer', () => {
      const entry = {
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        path: '/home',
        timestamp: '2026-01-08T12:00:00Z',
        referrer: '-'
      };

      calculator.processEntry(entry);

      expect(calculator.processedEntries).toHaveLength(1);
      expect(calculator.referrers.size).toBe(0);
    });

    it('should handle invalid referrer URLs', () => {
      const entry = {
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        path: '/home',
        timestamp: '2026-01-08T12:00:00Z',
        referrer: 'not-a-valid-url'
      };

      calculator.processEntry(entry);

      expect(calculator.processedEntries).toHaveLength(1);
      expect(calculator.referrers.size).toBe(0);
    });
  });

  describe('processBatch', () => {
    it('should process multiple entries', () => {
      const entries = [
        {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          path: '/home',
          timestamp: '2026-01-08T12:00:00Z',
          referrer: 'https://google.com'
        },
        {
          ip: '192.168.1.2',
          userAgent: 'Chrome/91.0',
          path: '/about',
          timestamp: '2026-01-08T12:01:00Z',
          referrer: 'https://facebook.com'
        },
        {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          path: '/contact',
          timestamp: '2026-01-08T12:02:00Z',
          referrer: '-'
        }
      ];

      calculator.processBatch(entries);

      expect(calculator.processedEntries).toHaveLength(3);
      expect(calculator.uniqueVisitors.size).toBe(2); // Same IP+UA for first and third
      expect(calculator.pageviews.size).toBe(3);
      expect(calculator.referrers.size).toBe(2);
    });
  });

  describe('generateTimeSeriesData', () => {
    beforeEach(() => {
      // Add test data spanning multiple days
      const entries = [
        {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          path: '/home',
          timestamp: '2026-01-08T10:00:00Z'
        },
        {
          ip: '192.168.1.2',
          userAgent: 'Chrome/91.0',
          path: '/about',
          timestamp: '2026-01-08T14:00:00Z'
        },
        {
          ip: '192.168.1.3',
          userAgent: 'Safari/14.0',
          path: '/contact',
          timestamp: '2026-01-09T09:00:00Z'
        }
      ];

      calculator.processBatch(entries);
    });

    it('should generate daily time-series data', () => {
      const result = calculator.generateTimeSeriesData('daily');

      expect(result.groupBy).toBe('daily');
      expect(result.timezone).toBe('UTC');
      expect(result.totalPageviews).toBe(3);
      expect(result.uniqueVisitors).toBe(3);
      expect(result.buckets).toHaveLength(2); // 2 days
      
      // Check bucket structure
      result.buckets.forEach(bucket => {
        expect(bucket).toHaveProperty('timestamp');
        expect(bucket).toHaveProperty('pageviews');
        expect(bucket).toHaveProperty('uniqueVisitors');
        expect(bucket).toHaveProperty('entries');
      });
    });

    it('should generate hourly time-series data', () => {
      const result = calculator.generateTimeSeriesData('hourly');

      expect(result.groupBy).toBe('hourly');
      expect(result.buckets.length).toBeGreaterThan(0);
    });

    it('should handle empty data', () => {
      const emptyCalc = new AnalyticsCalculator();
      const result = emptyCalc.generateTimeSeriesData();

      expect(result.buckets).toEqual([]);
      expect(result.totalPageviews).toBe(0);
      expect(result.uniqueVisitors).toBe(0);
    });
  });

  describe('generateTopContentData', () => {
    beforeEach(() => {
      const entries = [
        { ip: '192.168.1.1', userAgent: 'Mozilla/5.0', path: '/home', timestamp: '2026-01-08T12:00:00Z' },
        { ip: '192.168.1.2', userAgent: 'Chrome/91.0', path: '/home', timestamp: '2026-01-08T12:01:00Z' },
        { ip: '192.168.1.3', userAgent: 'Safari/14.0', path: '/about', timestamp: '2026-01-08T12:02:00Z' },
        { ip: '192.168.1.1', userAgent: 'Mozilla/5.0', path: '/home', timestamp: '2026-01-08T12:03:00Z' },
        { ip: '192.168.1.4', userAgent: 'Edge/91.0', path: '/contact', timestamp: '2026-01-08T12:04:00Z' }
      ];

      calculator.processBatch(entries);
    });

    it('should generate top content data', () => {
      const result = calculator.generateTopContentData(10);

      expect(result.totalPages).toBe(3);
      expect(result.totalPageviews).toBe(5);
      expect(result.uniqueVisitors).toBe(4);
      expect(result.topPages).toHaveLength(3);

      // Check top page is /home with 3 pageviews
      const topPage = result.topPages[0];
      expect(topPage.path).toBe('/home');
      expect(topPage.pageviews).toBe(3);
      expect(topPage.uniqueVisitors).toBe(2); // IP1 and IP2
      expect(topPage.percentage).toBe(60); // 3/5 * 100
    });

    it('should limit results correctly', () => {
      const result = calculator.generateTopContentData(2);

      expect(result.topPages).toHaveLength(2);
    });

    it('should handle empty data', () => {
      const emptyCalc = new AnalyticsCalculator();
      const result = emptyCalc.generateTopContentData();

      expect(result.totalPages).toBe(0);
      expect(result.topPages).toEqual([]);
    });
  });

  describe('generateReferrerData', () => {
    beforeEach(() => {
      const entries = [
        {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          path: '/home',
          timestamp: '2026-01-08T12:00:00Z',
          referrer: 'https://google.com/search?q=test'
        },
        {
          ip: '192.168.1.2',
          userAgent: 'Chrome/91.0',
          path: '/about',
          timestamp: '2026-01-08T12:01:00Z',
          referrer: 'https://google.com/search?q=other'
        },
        {
          ip: '192.168.1.3',
          userAgent: 'Safari/14.0',
          path: '/contact',
          timestamp: '2026-01-08T12:02:00Z',
          referrer: 'https://facebook.com/page'
        },
        {
          ip: '192.168.1.4',
          userAgent: 'Edge/91.0',
          path: '/home',
          timestamp: '2026-01-08T12:03:00Z',
          referrer: '-'
        }
      ];

      calculator.processBatch(entries);
    });

    it('should generate referrer data grouped by domain', () => {
      const result = calculator.generateReferrerData(10, 5);

      expect(result.totalReferrerDomains).toBe(2);
      expect(result.totalReferrals).toBe(3);
      expect(result.directTraffic).toBe(1);
      expect(result.topReferrers).toHaveLength(2);

      // Check top referrer is google.com
      const topReferrer = result.topReferrers[0];
      expect(topReferrer.domain).toBe('google.com');
      expect(topReferrer.totalReferrals).toBe(2);
      expect(topReferrer.topPaths).toHaveLength(2);
    });

    it('should limit referrer domains correctly', () => {
      const result = calculator.generateReferrerData(1, 3);

      expect(result.topReferrers).toHaveLength(1);
    });

    it('should limit paths per domain correctly', () => {
      const result = calculator.generateReferrerData(10, 1);

      result.topReferrers.forEach(referrer => {
        expect(referrer.topPaths.length).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('generateSummaryStatistics', () => {
    beforeEach(() => {
      const entries = [
        { ip: '192.168.1.1', userAgent: 'Mozilla/5.0', path: '/home', timestamp: '2026-01-08T12:00:00Z', referrer: 'https://google.com' },
        { ip: '192.168.1.2', userAgent: 'Chrome/91.0', path: '/about', timestamp: '2026-01-08T12:01:00Z', referrer: 'https://facebook.com' },
        { ip: '192.168.1.1', userAgent: 'Mozilla/5.0', path: '/contact', timestamp: '2026-01-08T12:02:00Z', referrer: '-' }
      ];

      calculator.processBatch(entries);
    });

    it('should generate comprehensive summary statistics', () => {
      const result = calculator.generateSummaryStatistics();

      expect(result.totalPageviews).toBe(3);
      expect(result.uniqueVisitors).toBe(2);
      expect(result.totalPages).toBe(3);
      expect(result.totalReferrerDomains).toBe(2);
      expect(result.avgPageviewsPerSession).toBe(1.5); // 3 pageviews / 2 visitors
      expect(result.directTraffic).toBe(1);
      expect(result.referralTraffic).toBe(2);
      expect(result.topPages).toHaveLength(3);
      expect(result.topReferrers).toHaveLength(2);
      expect(result.generatedAt).toBeDefined();
      expect(result.dataRange.start).toBeDefined();
      expect(result.dataRange.end).toBeDefined();
    });
  });

  describe('generateCompleteDataset', () => {
    beforeEach(() => {
      const entries = [
        { ip: '192.168.1.1', userAgent: 'Mozilla/5.0', path: '/home', timestamp: '2026-01-08T12:00:00Z', referrer: 'https://google.com' },
        { ip: '192.168.1.2', userAgent: 'Chrome/91.0', path: '/about', timestamp: '2026-01-08T12:01:00Z', referrer: 'https://facebook.com' }
      ];

      calculator.processBatch(entries);
    });

    it('should generate complete analytics dataset', () => {
      const result = calculator.generateCompleteDataset();

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('timeSeries');
      expect(result).toHaveProperty('topContent');
      expect(result).toHaveProperty('referrers');
      expect(result).toHaveProperty('metadata');

      // Check time-series includes all periods
      expect(result.timeSeries).toHaveProperty('hourly');
      expect(result.timeSeries).toHaveProperty('daily');
      expect(result.timeSeries).toHaveProperty('monthly');

      // Check metadata
      expect(result.metadata.generatedAt).toBeDefined();
      expect(result.metadata.timezone).toBe('UTC');
      expect(result.metadata.totalEntriesProcessed).toBe(2);
    });

    it('should respect custom options', () => {
      const result = calculator.generateCompleteDataset({
        topContentLimit: 5,
        topReferrersLimit: 3
      });

      expect(result.topContent.topPages.length).toBeLessThanOrEqual(5);
      expect(result.referrers.topReferrers.length).toBeLessThanOrEqual(3);
    });
  });

  describe('reset', () => {
    it('should reset all analytics data', () => {
      const entries = [
        { ip: '192.168.1.1', userAgent: 'Mozilla/5.0', path: '/home', timestamp: '2026-01-08T12:00:00Z', referrer: 'https://google.com' }
      ];

      calculator.processBatch(entries);
      expect(calculator.processedEntries).toHaveLength(1);

      calculator.reset();

      expect(calculator.processedEntries).toHaveLength(0);
      expect(calculator.uniqueVisitors.size).toBe(0);
      expect(calculator.pageviews.size).toBe(0);
      expect(calculator.referrers.size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return processing statistics', () => {
      const entries = [
        { ip: '192.168.1.1', userAgent: 'Mozilla/5.0', path: '/home', timestamp: '2026-01-08T12:00:00Z', referrer: 'https://google.com' },
        { ip: '192.168.1.2', userAgent: 'Chrome/91.0', path: '/about', timestamp: '2026-01-08T12:01:00Z', referrer: 'https://facebook.com' }
      ];

      calculator.processBatch(entries);
      const stats = calculator.getStats();

      expect(stats.entriesProcessed).toBe(2);
      expect(stats.uniqueVisitors).toBe(2);
      expect(stats.uniquePages).toBe(2);
      expect(stats.referrerDomains).toBe(2);
      expect(stats.memoryUsage).toHaveProperty('entries');
      expect(stats.memoryUsage).toHaveProperty('visitors');
      expect(stats.memoryUsage).toHaveProperty('pages');
      expect(stats.memoryUsage).toHaveProperty('referrers');
    });
  });

  describe('utility functions', () => {
    it('should create analytics calculator', () => {
      const calc = createAnalyticsCalculator({ salt: 'test' });
      
      expect(calc).toBeInstanceOf(AnalyticsCalculator);
      expect(calc.salt).toBe('test');
    });

    it('should extract domain from URL', () => {
      expect(extractDomain('https://google.com/search')).toBe('google.com');
      expect(extractDomain('http://facebook.com/page')).toBe('facebook.com');
      expect(extractDomain('https://subdomain.example.com/path')).toBe('subdomain.example.com');
      expect(extractDomain('invalid-url')).toBeNull();
      expect(extractDomain('')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle duplicate entries correctly', () => {
      const entry = {
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        path: '/home',
        timestamp: '2026-01-08T12:00:00Z',
        referrer: 'https://google.com'
      };

      // Process same entry multiple times
      calculator.processEntry(entry);
      calculator.processEntry(entry);
      calculator.processEntry(entry);

      expect(calculator.processedEntries).toHaveLength(3);
      expect(calculator.uniqueVisitors.size).toBe(1); // Same visitor
      expect(calculator.pageviews.get('/home')).toBe(3);
    });

    it('should handle entries with same path but different visitors', () => {
      const entries = [
        { ip: '192.168.1.1', userAgent: 'Mozilla/5.0', path: '/home', timestamp: '2026-01-08T12:00:00Z' },
        { ip: '192.168.1.2', userAgent: 'Chrome/91.0', path: '/home', timestamp: '2026-01-08T12:01:00Z' },
        { ip: '192.168.1.3', userAgent: 'Safari/14.0', path: '/home', timestamp: '2026-01-08T12:02:00Z' }
      ];

      calculator.processBatch(entries);

      const topContent = calculator.generateTopContentData();
      const homePage = topContent.topPages.find(page => page.path === '/home');
      
      expect(homePage.pageviews).toBe(3);
      expect(homePage.uniqueVisitors).toBe(3);
    });

    it('should handle referrers with same domain but different paths', () => {
      const entries = [
        { ip: '192.168.1.1', userAgent: 'Mozilla/5.0', path: '/home', timestamp: '2026-01-08T12:00:00Z', referrer: 'https://google.com/search?q=test1' },
        { ip: '192.168.1.2', userAgent: 'Chrome/91.0', path: '/about', timestamp: '2026-01-08T12:01:00Z', referrer: 'https://google.com/search?q=test2' },
        { ip: '192.168.1.3', userAgent: 'Safari/14.0', path: '/contact', timestamp: '2026-01-08T12:02:00Z', referrer: 'https://google.com/images?q=test3' }
      ];

      calculator.processBatch(entries);

      const referrerData = calculator.generateReferrerData();
      const googleReferrer = referrerData.topReferrers.find(ref => ref.domain === 'google.com');
      
      expect(googleReferrer.totalReferrals).toBe(3);
      expect(googleReferrer.topPaths).toHaveLength(3);
    });
  });
});