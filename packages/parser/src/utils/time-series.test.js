/**
 * @fileoverview Tests for time-series data grouping utilities
 */

const { TimeSeriesGrouper, groupByTimePeriod, generateTimeSeriesForRange } = require('./time-series');

describe('TimeSeriesGrouper', () => {
  // Sample log entries for testing
  const createSampleEntries = () => [
    {
      timestamp: new Date('2026-01-04T10:30:00Z'),
      ip: '192.168.1.1',
      method: 'GET',
      path: '/home',
      status: 200,
      bytes: 1234,
      referrer: 'https://google.com',
      userAgent: 'Mozilla/5.0 Chrome'
    },
    {
      timestamp: new Date('2026-01-04T10:45:00Z'),
      ip: '192.168.1.2',
      method: 'GET',
      path: '/about',
      status: 200,
      bytes: 2345,
      referrer: 'https://google.com',
      userAgent: 'Mozilla/5.0 Firefox'
    },
    {
      timestamp: new Date('2026-01-04T11:15:00Z'),
      ip: '192.168.1.1',
      method: 'GET',
      path: '/contact',
      status: 200,
      bytes: 3456,
      referrer: 'direct',
      userAgent: 'Mozilla/5.0 Chrome'
    },
    {
      timestamp: new Date('2026-01-04T12:30:00Z'),
      ip: '192.168.1.3',
      method: 'GET',
      path: '/blog',
      status: 200,
      bytes: 4567,
      referrer: 'https://example.com',
      userAgent: 'Mozilla/5.0 Safari'
    }
  ];

  describe('constructor', () => {
    it('should create grouper with default timezone', () => {
      const grouper = new TimeSeriesGrouper();
      expect(grouper.timezone).toBe('UTC');
    });

    it('should create grouper with custom timezone', () => {
      const grouper = new TimeSeriesGrouper('America/New_York');
      expect(grouper.timezone).toBe('America/New_York');
    });
  });

  describe('groupByTimePeriod', () => {
    const grouper = new TimeSeriesGrouper();

    it('should group entries by hourly periods', () => {
      const entries = createSampleEntries();
      const startDate = new Date('2026-01-04T10:00:00Z');
      const endDate = new Date('2026-01-04T13:00:00Z');
      
      const result = grouper.groupByTimePeriod(entries, 'hourly', startDate, endDate);
      
      expect(result.period).toBe('hourly');
      expect(result.buckets).toHaveLength(3); // 10-11, 11-12, 12-13
      
      // Check first bucket (10-11 hour)
      const firstBucket = result.buckets[0];
      expect(firstBucket.key).toBe('2026-01-04T10:00:00Z');
      expect(firstBucket.pageviews).toBe(2); // Two entries in 10:xx hour
      expect(firstBucket.uniqueVisitors).toBe(2); // Two different IPs
      expect(firstBucket.totalRequests).toBe(2);
      
      // Check second bucket (11-12 hour)
      const secondBucket = result.buckets[1];
      expect(secondBucket.key).toBe('2026-01-04T11:00:00Z');
      expect(secondBucket.pageviews).toBe(1); // One entry in 11:xx hour
      expect(secondBucket.uniqueVisitors).toBe(1);
      
      // Check third bucket (12-13 hour)
      const thirdBucket = result.buckets[2];
      expect(thirdBucket.key).toBe('2026-01-04T12:00:00Z');
      expect(thirdBucket.pageviews).toBe(1); // One entry in 12:xx hour
      expect(thirdBucket.uniqueVisitors).toBe(1);
    });

    it('should group entries by daily periods', () => {
      const entries = [
        {
          timestamp: new Date('2026-01-04T10:30:00Z'),
          ip: '192.168.1.1',
          method: 'GET',
          path: '/home',
          status: 200,
          bytes: 1234,
          userAgent: 'Mozilla/5.0'
        },
        {
          timestamp: new Date('2026-01-05T14:30:00Z'),
          ip: '192.168.1.2',
          method: 'GET',
          path: '/about',
          status: 200,
          bytes: 2345,
          userAgent: 'Mozilla/5.0'
        }
      ];
      
      const startDate = new Date('2026-01-04T00:00:00Z');
      const endDate = new Date('2026-01-06T00:00:00Z');
      
      const result = grouper.groupByTimePeriod(entries, 'daily', startDate, endDate);
      
      expect(result.period).toBe('daily');
      expect(result.buckets).toHaveLength(2);
      
      const firstDay = result.buckets[0];
      expect(firstDay.key).toBe('2026-01-04');
      expect(firstDay.pageviews).toBe(1);
      
      const secondDay = result.buckets[1];
      expect(secondDay.key).toBe('2026-01-05');
      expect(secondDay.pageviews).toBe(1);
    });

    it('should group entries by monthly periods', () => {
      const entries = [
        {
          timestamp: new Date('2026-01-15T10:30:00Z'),
          ip: '192.168.1.1',
          method: 'GET',
          path: '/home',
          status: 200,
          bytes: 1234,
          userAgent: 'Mozilla/5.0'
        },
        {
          timestamp: new Date('2026-02-15T14:30:00Z'),
          ip: '192.168.1.2',
          method: 'GET',
          path: '/about',
          status: 200,
          bytes: 2345,
          userAgent: 'Mozilla/5.0'
        }
      ];
      
      const startDate = new Date('2026-01-01T00:00:00Z');
      const endDate = new Date('2026-03-01T00:00:00Z');
      
      const result = grouper.groupByTimePeriod(entries, 'monthly', startDate, endDate);
      
      expect(result.period).toBe('monthly');
      expect(result.buckets).toHaveLength(2);
      
      const firstMonth = result.buckets[0];
      expect(firstMonth.key).toBe('2026-01');
      expect(firstMonth.pageviews).toBe(1);
      
      const secondMonth = result.buckets[1];
      expect(secondMonth.key).toBe('2026-02');
      expect(secondMonth.pageviews).toBe(1);
    });

    it('should handle empty entries array', () => {
      const result = grouper.groupByTimePeriod([], 'daily');
      
      expect(result.buckets).toHaveLength(0);
      expect(result.totalEntries).toBe(0);
    });

    it('should filter out non-pageview entries', () => {
      const entries = [
        {
          timestamp: new Date('2026-01-04T10:30:00Z'),
          ip: '192.168.1.1',
          method: 'GET',
          path: '/home',
          status: 200,
          bytes: 1234,
          userAgent: 'Mozilla/5.0'
        },
        {
          timestamp: new Date('2026-01-04T10:45:00Z'),
          ip: '192.168.1.2',
          method: 'GET',
          path: '/style.css', // Static asset - should not count as pageview
          status: 200,
          bytes: 2345,
          userAgent: 'Mozilla/5.0'
        },
        {
          timestamp: new Date('2026-01-04T11:00:00Z'),
          ip: '192.168.1.3',
          method: 'POST', // POST method - should not count as pageview
          path: '/api/data',
          status: 200,
          bytes: 3456,
          userAgent: 'Mozilla/5.0'
        }
      ];
      
      const result = grouper.groupByTimePeriod(entries, 'hourly');
      
      // Should have buckets but only count valid pageviews
      const bucket = result.buckets.find(b => b.pageviews > 0);
      expect(bucket.pageviews).toBe(1); // Only the first entry counts as pageview
      expect(bucket.totalRequests).toBe(2); // But total requests includes all in that hour
    });

    it('should count unique visitors correctly', () => {
      const entries = [
        {
          timestamp: new Date('2026-01-04T10:30:00Z'),
          ip: '192.168.1.1',
          method: 'GET',
          path: '/home',
          status: 200,
          bytes: 1234,
          userAgent: 'Mozilla/5.0 Chrome'
        },
        {
          timestamp: new Date('2026-01-04T10:45:00Z'),
          ip: '192.168.1.1', // Same IP
          method: 'GET',
          path: '/about',
          status: 200,
          bytes: 2345,
          userAgent: 'Mozilla/5.0 Chrome' // Same user agent
        },
        {
          timestamp: new Date('2026-01-04T10:50:00Z'),
          ip: '192.168.1.2', // Different IP
          method: 'GET',
          path: '/contact',
          status: 200,
          bytes: 3456,
          userAgent: 'Mozilla/5.0 Firefox'
        }
      ];
      
      const result = grouper.groupByTimePeriod(entries, 'hourly');
      
      const bucket = result.buckets[0];
      expect(bucket.uniqueVisitors).toBe(2); // Two unique IP+UserAgent combinations
      expect(bucket.pageviews).toBe(3); // Three pageviews total
    });
  });

  describe('generateCompleteTimeSeries', () => {
    const grouper = new TimeSeriesGrouper();

    it('should zero-fill missing time periods', () => {
      const entries = [
        {
          timestamp: new Date('2026-01-04T10:30:00Z'),
          ip: '192.168.1.1',
          method: 'GET',
          path: '/home',
          status: 200,
          bytes: 1234,
          userAgent: 'Mozilla/5.0'
        }
        // Note: No entries for 11:xx or 12:xx hours
      ];
      
      const startDate = new Date('2026-01-04T10:00:00Z');
      const endDate = new Date('2026-01-04T13:00:00Z');
      
      const result = grouper.generateCompleteTimeSeries(entries, 'hourly', startDate, endDate);
      
      expect(result.buckets).toHaveLength(3);
      
      // First bucket should have data
      expect(result.buckets[0].key).toBe('2026-01-04T10:00:00Z');
      expect(result.buckets[0].pageviews).toBe(1);
      
      // Second and third buckets should be zero-filled
      expect(result.buckets[1].key).toBe('2026-01-04T11:00:00Z');
      expect(result.buckets[1].pageviews).toBe(0);
      expect(result.buckets[1].uniqueVisitors).toBe(0);
      expect(result.buckets[2].key).toBe('2026-01-04T12:00:00Z');
      expect(result.buckets[2].pageviews).toBe(0);
      expect(result.buckets[2].uniqueVisitors).toBe(0);
    });
  });

  describe('static methods', () => {
    describe('getTimeRange', () => {
      const referenceDate = new Date('2026-01-04T12:00:00Z');

      it('should return correct range for 1d', () => {
        const { start, end } = TimeSeriesGrouper.getTimeRange('1d', referenceDate);
        
        expect(end).toEqual(referenceDate);
        expect(start.getDate()).toBe(referenceDate.getDate() - 1);
      });

      it('should return correct range for 7d', () => {
        const { start, end } = TimeSeriesGrouper.getTimeRange('7d', referenceDate);
        
        expect(end).toEqual(referenceDate);
        expect(start.getTime()).toBe(referenceDate.getTime() - (7 * 24 * 60 * 60 * 1000));
      });

      it('should return correct range for 30d', () => {
        const { start, end } = TimeSeriesGrouper.getTimeRange('30d', referenceDate);
        
        expect(end).toEqual(referenceDate);
        expect(start.getTime()).toBe(referenceDate.getTime() - (30 * 24 * 60 * 60 * 1000));
      });

      it('should return correct range for 1y', () => {
        const { start, end } = TimeSeriesGrouper.getTimeRange('1y', referenceDate);
        
        expect(end).toEqual(referenceDate);
        expect(start.getFullYear()).toBe(referenceDate.getFullYear() - 1);
      });

      it('should throw error for unsupported range', () => {
        expect(() => {
          TimeSeriesGrouper.getTimeRange('invalid');
        }).toThrow('Unsupported time range: invalid');
      });
    });

    describe('getRecommendedPeriod', () => {
      it('should recommend hourly for 1d', () => {
        expect(TimeSeriesGrouper.getRecommendedPeriod('1d')).toBe('hourly');
      });

      it('should recommend daily for 7d and 30d', () => {
        expect(TimeSeriesGrouper.getRecommendedPeriod('7d')).toBe('daily');
        expect(TimeSeriesGrouper.getRecommendedPeriod('30d')).toBe('daily');
      });

      it('should recommend monthly for 1y and all', () => {
        expect(TimeSeriesGrouper.getRecommendedPeriod('1y')).toBe('monthly');
        expect(TimeSeriesGrouper.getRecommendedPeriod('all')).toBe('monthly');
      });

      it('should default to daily for unknown ranges', () => {
        expect(TimeSeriesGrouper.getRecommendedPeriod('unknown')).toBe('daily');
      });
    });
  });

  describe('getBucketKey', () => {
    const grouper = new TimeSeriesGrouper();

    it('should generate correct hourly keys', () => {
      const date = new Date('2026-01-04T15:30:45Z');
      const key = grouper.getBucketKey(date, 'hourly');
      
      expect(key).toBe('2026-01-04T15:00:00Z');
    });

    it('should generate correct daily keys', () => {
      const date = new Date('2026-01-04T15:30:45Z');
      const key = grouper.getBucketKey(date, 'daily');
      
      expect(key).toBe('2026-01-04');
    });

    it('should generate correct monthly keys', () => {
      const date = new Date('2026-01-04T15:30:45Z');
      const key = grouper.getBucketKey(date, 'monthly');
      
      expect(key).toBe('2026-01');
    });
  });
});

describe('Convenience functions', () => {
  describe('groupByTimePeriod', () => {
    it('should work as convenience function', () => {
      const entries = [
        {
          timestamp: new Date('2026-01-04T10:30:00Z'),
          ip: '192.168.1.1',
          method: 'GET',
          path: '/home',
          status: 200,
          bytes: 1234,
          userAgent: 'Mozilla/5.0'
        }
      ];
      
      const result = groupByTimePeriod(entries, 'daily');
      
      expect(result.period).toBe('daily');
      expect(result.buckets.length).toBeGreaterThan(0);
    });
  });

  describe('generateTimeSeriesForRange', () => {
    it('should generate time series for predefined range', () => {
      const entries = [
        {
          timestamp: new Date('2026-01-04T10:30:00Z'),
          ip: '192.168.1.1',
          method: 'GET',
          path: '/home',
          status: 200,
          bytes: 1234,
          userAgent: 'Mozilla/5.0'
        }
      ];
      
      const result = generateTimeSeriesForRange(entries, '1d');
      
      expect(result.period).toBe('hourly'); // Recommended for 1d
      expect(result.buckets.length).toBeGreaterThan(0);
    });
  });
});