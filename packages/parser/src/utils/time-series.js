/**
 * @fileoverview Time-series data grouping utilities for analytics
 */

/**
 * Time-series data grouping utility
 */
class TimeSeriesGrouper {
  /**
   * @param {string} [timezone='UTC'] - Timezone for grouping (default UTC)
   */
  constructor(timezone = 'UTC') {
    this.timezone = timezone;
  }

  /**
   * Group log entries by time periods
   * @param {import('@analytics-system/shared').LogEntry[]} entries - Log entries to group
   * @param {string} period - Time period ('hourly', 'daily', 'monthly')
   * @param {Date} [startDate] - Start date for grouping (optional)
   * @param {Date} [endDate] - End date for grouping (optional)
   * @returns {Object} Grouped data with time buckets
   */
  groupByTimePeriod(entries, period, startDate = null, endDate = null) {
    if (!entries || entries.length === 0) {
      return this.createEmptyTimeSeriesData(period, startDate, endDate);
    }

    // Determine date range if not provided
    if (!startDate || !endDate) {
      const timestamps = entries.map(entry => entry.timestamp).sort((a, b) => a - b);
      startDate = startDate || timestamps[0];
      endDate = endDate || timestamps[timestamps.length - 1];
      
      // Ensure endDate extends to include the period containing the last entry
      if (endDate.getTime() <= startDate.getTime()) {
        endDate = this.getNextPeriodDate(startDate, period);
      } else {
        // Extend endDate to the next period boundary to ensure the last entry's period is included
        endDate = this.getNextPeriodDate(endDate, period);
      }
    }

    // Create time buckets
    const buckets = this.createTimeBuckets(period, startDate, endDate);
    
    // Group entries into buckets
    const groupedData = this.groupEntriesIntoBuckets(entries, buckets, period);
    
    return {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      period,
      buckets: groupedData,
      totalEntries: entries.length
    };
  }

  /**
   * Create time buckets for a given period
   * @param {string} period - Time period ('hourly', 'daily', 'monthly')
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Array} Array of time bucket objects
   * @private
   */
  createTimeBuckets(period, startDate, endDate) {
    const buckets = [];
    const current = new Date(startDate);
    
    // Normalize start date to period boundary
    switch (period) {
      case 'hourly':
        current.setUTCMinutes(0, 0, 0);
        break;
      case 'daily':
        current.setUTCHours(0, 0, 0, 0);
        break;
      case 'monthly':
        current.setUTCDate(1);
        current.setUTCHours(0, 0, 0, 0);
        break;
    }
    
    while (current < endDate) {
      const bucketStart = new Date(current);
      const bucketEnd = this.getNextPeriodDate(current, period);
      
      buckets.push({
        start: bucketStart,
        end: bucketEnd,
        key: this.getBucketKey(bucketStart, period),
        entries: [],
        pageviews: 0,
        uniqueVisitors: new Set(),
        bytes: 0
      });
      
      current.setTime(bucketEnd.getTime());
    }
    
    return buckets;
  }

  /**
   * Get the next period date
   * @param {Date} date - Current date
   * @param {string} period - Time period
   * @returns {Date} Next period date
   * @private
   */
  getNextPeriodDate(date, period) {
    const next = new Date(date);
    
    switch (period) {
      case 'hourly':
        next.setUTCHours(next.getUTCHours() + 1);
        next.setUTCMinutes(0, 0, 0);
        break;
      case 'daily':
        next.setUTCDate(next.getUTCDate() + 1);
        next.setUTCHours(0, 0, 0, 0);
        break;
      case 'monthly':
        next.setUTCMonth(next.getUTCMonth() + 1);
        next.setUTCDate(1);
        next.setUTCHours(0, 0, 0, 0);
        break;
      default:
        throw new Error(`Unsupported period: ${period}`);
    }
    
    return next;
  }

  /**
   * Get bucket key for a date and period
   * @param {Date} date - Date
   * @param {string} period - Time period
   * @returns {string} Bucket key
   * @private
   */
  getBucketKey(date, period) {
    // Work with UTC to avoid timezone issues
    const utcDate = new Date(date.getTime());
    
    switch (period) {
      case 'hourly':
        return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, '0')}-${String(utcDate.getUTCDate()).padStart(2, '0')}T${String(utcDate.getUTCHours()).padStart(2, '0')}:00:00Z`;
      case 'daily':
        return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, '0')}-${String(utcDate.getUTCDate()).padStart(2, '0')}`;
      case 'monthly':
        return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, '0')}`;
      default:
        return utcDate.toISOString();
    }
  }

  /**
   * Group entries into time buckets
   * @param {Array} entries - Log entries
   * @param {Array} buckets - Time buckets
   * @param {string} period - Time period
   * @returns {Array} Buckets with grouped data
   * @private
   */
  groupEntriesIntoBuckets(entries, buckets, period) {
    // Create a map for faster bucket lookup
    const bucketMap = new Map();
    buckets.forEach(bucket => {
      bucketMap.set(bucket.key, bucket);
    });

    // Group entries into buckets
    entries.forEach(entry => {
      const bucketKey = this.getBucketKey(entry.timestamp, period);
      const bucket = bucketMap.get(bucketKey);
      
      if (bucket) {
        bucket.entries.push(entry);
        
        // Count pageviews (only for valid pageview entries)
        if (this.isPageview(entry)) {
          bucket.pageviews++;
        }
        
        // Track unique visitors
        const visitorHash = this.getVisitorHash(entry);
        if (visitorHash) {
          bucket.uniqueVisitors.add(visitorHash);
        }
        
        // Sum bytes
        bucket.bytes += entry.bytes || 0;
      }
    });

    // Convert Sets to counts and clean up
    return buckets.map(bucket => ({
      key: bucket.key,
      start: bucket.start.toISOString(),
      end: bucket.end.toISOString(),
      pageviews: bucket.pageviews,
      uniqueVisitors: bucket.uniqueVisitors.size,
      totalRequests: bucket.entries.length,
      bytes: bucket.bytes,
      // Don't include raw entries in final output to save memory
      ...(process.env.NODE_ENV === 'development' && { entries: bucket.entries })
    }));
  }

  /**
   * Check if entry is a pageview
   * @param {Object} entry - Log entry
   * @returns {boolean} True if pageview
   * @private
   */
  isPageview(entry) {
    // Define constants locally to avoid import issues
    const PAGEVIEW_CODES = [200, 201, 202, 203, 204, 205, 206, 300, 301, 302, 303, 304, 307, 308];
    const EXCLUDED_EXTENSIONS = [
      '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2',
      '.ttf', '.eot', '.otf', '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3', '.avi',
      '.mov', '.wmv', '.flv', '.webm', '.ogg', '.wav', '.xml', '.txt', '.json'
    ];
    
    if (!PAGEVIEW_CODES.includes(entry.status)) {
      return false;
    }

    const path = entry.path.toLowerCase();
    const hasExcludedExtension = EXCLUDED_EXTENSIONS.some(ext => 
      path.endsWith(ext.toLowerCase())
    );
    
    if (hasExcludedExtension) {
      return false;
    }

    const validMethods = ['GET', 'HEAD'];
    if (!validMethods.includes(entry.method)) {
      return false;
    }

    // Check if user agent is valid (not empty or whitespace-only)
    if (!entry.userAgent || entry.userAgent.trim().length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Get visitor hash from entry
   * @param {Object} entry - Log entry
   * @returns {string|null} Visitor hash or null
   * @private
   */
  getVisitorHash(entry) {
    if (!entry.ip || !entry.userAgent) {
      return null;
    }
    
    // Use the visitor hash utility
    const { generateVisitorHash } = require('./visitor-hash');
    return generateVisitorHash(entry.ip, entry.userAgent);
  }

  /**
   * Create empty time series data structure
   * @param {string} period - Time period
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} Empty time series data
   * @private
   */
  createEmptyTimeSeriesData(period, startDate, endDate) {
    const now = new Date();
    const start = startDate || now;
    const end = endDate || now;
    
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      period,
      buckets: [],
      totalEntries: 0
    };
  }

  /**
   * Generate complete time series with zero-fill for missing periods
   * @param {Array} entries - Log entries
   * @param {string} period - Time period
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} Complete time series with zero-filled gaps
   */
  generateCompleteTimeSeries(entries, period, startDate, endDate) {
    const grouped = this.groupByTimePeriod(entries, period, startDate, endDate);
    
    // Ensure all time periods are represented (zero-fill)
    const allBuckets = this.createTimeBuckets(period, new Date(grouped.start), new Date(grouped.end));
    const dataMap = new Map(grouped.buckets.map(bucket => [bucket.key, bucket]));
    
    const completeBuckets = allBuckets.map(bucket => {
      const existingData = dataMap.get(bucket.key);
      return existingData || {
        key: bucket.key,
        start: bucket.start.toISOString(),
        end: bucket.end.toISOString(),
        pageviews: 0,
        uniqueVisitors: 0,
        totalRequests: 0,
        bytes: 0
      };
    });
    
    return {
      ...grouped,
      buckets: completeBuckets
    };
  }

  /**
   * Get predefined time ranges for common analytics periods
   * @param {string} range - Range identifier ('1d', '7d', '30d', '1y', 'all')
   * @param {Date} [referenceDate] - Reference date (defaults to now)
   * @returns {Object} Start and end dates for the range
   */
  static getTimeRange(range, referenceDate = new Date()) {
    const end = new Date(referenceDate);
    const start = new Date(referenceDate);
    
    switch (range) {
      case '1d':
        start.setDate(start.getDate() - 1);
        break;
      case '7d':
        start.setDate(start.getDate() - 7);
        break;
      case '30d':
        start.setDate(start.getDate() - 30);
        break;
      case '1y':
        start.setFullYear(start.getFullYear() - 1);
        break;
      case 'all':
        start.setFullYear(2000); // Far back date for "all time"
        break;
      default:
        throw new Error(`Unsupported time range: ${range}`);
    }
    
    return { start, end };
  }

  /**
   * Get recommended period for a time range
   * @param {string} range - Range identifier
   * @returns {string} Recommended period
   */
  static getRecommendedPeriod(range) {
    switch (range) {
      case '1d':
        return 'hourly';
      case '7d':
      case '30d':
        return 'daily';
      case '1y':
      case 'all':
        return 'monthly';
      default:
        return 'daily';
    }
  }
}

/**
 * Convenience function for grouping entries by time period
 * @param {Array} entries - Log entries
 * @param {string} period - Time period
 * @param {Date} [startDate] - Start date
 * @param {Date} [endDate] - End date
 * @returns {Object} Grouped time series data
 */
function groupByTimePeriod(entries, period, startDate, endDate) {
  const grouper = new TimeSeriesGrouper();
  return grouper.groupByTimePeriod(entries, period, startDate, endDate);
}

/**
 * Convenience function for generating complete time series
 * @param {Array} entries - Log entries
 * @param {string} range - Time range ('1d', '7d', '30d', '1y', 'all')
 * @returns {Object} Complete time series data
 */
function generateTimeSeriesForRange(entries, range) {
  const { start, end } = TimeSeriesGrouper.getTimeRange(range);
  const period = TimeSeriesGrouper.getRecommendedPeriod(range);
  const grouper = new TimeSeriesGrouper();
  
  return grouper.generateCompleteTimeSeries(entries, period, start, end);
}

module.exports = {
  TimeSeriesGrouper,
  groupByTimePeriod,
  generateTimeSeriesForRange
};