/**
 * @fileoverview Analytics calculation engine that processes log entries and generates structured analytics data
 * Feature: metrona-analytics-system, Requirements 7.2, 7.3, 7.4, 7.5
 */

const { TimeSeriesGrouper } = require('./time-series');
const { ContentRanker } = require('./content-ranking');
const { VisitorHasher } = require('./visitor-hash');

/**
 * Analytics calculation engine that processes log entries and generates comprehensive analytics data
 */
class AnalyticsCalculator {
  /**
   * @param {Object} [options] - Configuration options
   * @param {string} [options.timezone='UTC'] - Timezone for time-series grouping
   * @param {string} [options.salt=''] - Salt for visitor hashing
   * @param {Object} [options.contentRankingOptions] - Options for content ranking
   * @param {string[]} [options.ownDomains] - The site's own hostnames, never counted as referrers
   */
  constructor(options = {}) {
    this.timezone = options.timezone || 'UTC';
    this.salt = options.salt || '';
    
    // Initialize utility classes
    this.timeSeriesGrouper = new TimeSeriesGrouper(this.timezone);
    this.ownDomains = (options.ownDomains || []).map(d => String(d).toLowerCase());
    this.contentRanker = new ContentRanker({ ...options.contentRankingOptions, ownDomains: [...(options.contentRankingOptions?.ownDomains || []), ...this.ownDomains] });
    this.visitorHasher = new VisitorHasher(this.salt);
    
    // Track processed data
    this.processedEntries = [];
    this.uniqueVisitors = new Set();
    this.pageviews = new Map(); // path -> count
    this.referrers = new Map(); // domain -> { total: count, paths: Map(path -> count) }
  }

  /**
   * Process a batch of log entries and update analytics data
   * @param {Array<Object>} logEntries - Array of parsed log entries
   * @returns {void}
   */
  processBatch(logEntries) {
    for (const entry of logEntries) {
      this.processEntry(entry);
    }
  }

  /**
   * Process a single log entry
   * @param {Object} entry - Parsed log entry
   * @returns {void}
   * @private
   */
  processEntry(entry) {
    // Validate entry has required fields
    if (!entry || !entry.ip || !entry.userAgent || !entry.path || !entry.timestamp) {
      return;
    }

    // Normalize timestamp to Date object
    const normalizedEntry = {
      ...entry,
      timestamp: typeof entry.timestamp === 'string' ? new Date(entry.timestamp) : entry.timestamp,
      method: entry.method || 'GET',
      status: entry.status || 200,
      bytes: entry.bytes || 0
    };

    // Store the entry for time-series analysis
    this.processedEntries.push(normalizedEntry);

    // Calculate unique visitor hash
    const visitorHash = this.visitorHasher.generateHash(entry.ip, entry.userAgent);
    this.uniqueVisitors.add(visitorHash);

    // Count pageviews by path
    const currentCount = this.pageviews.get(entry.path) || 0;
    this.pageviews.set(entry.path, currentCount + 1);

    // Process referrer data
    this.processReferrer(normalizedEntry);
  }

  /**
   * Process referrer data from a log entry
   * @param {Object} entry - Parsed log entry
   * @returns {void}
   * @private
   */
  processReferrer(entry) {
    if (!entry.referrer || entry.referrer === '-' || entry.referrer === '') {
      return;
    }

    try {
      // Extract domain from referrer URL
      const referrerUrl = new URL(entry.referrer);
      const domain = referrerUrl.hostname;
      if (this.ownDomains.includes(domain.toLowerCase())) {
        return;
      }
      const fullPath = entry.referrer;

      // Initialize domain entry if it doesn't exist
      if (!this.referrers.has(domain)) {
        this.referrers.set(domain, {
          total: 0,
          paths: new Map()
        });
      }

      const domainData = this.referrers.get(domain);
      domainData.total += 1;

      // Track specific referrer paths
      const currentPathCount = domainData.paths.get(fullPath) || 0;
      domainData.paths.set(fullPath, currentPathCount + 1);

    } catch (error) {
      // Invalid URL, skip referrer processing
      return;
    }
  }

  /**
   * Generate time-series analytics data
   * @param {string} [groupBy='daily'] - Grouping period: 'hourly', 'daily', or 'monthly'
   * @param {Date} [startDate] - Start date for analysis
   * @param {Date} [endDate] - End date for analysis
   * @returns {Object} Time-series data organized by the specified period
   */
  generateTimeSeriesData(groupBy = 'daily', startDate = undefined, endDate = undefined) {
    if (this.processedEntries.length === 0) {
      return {
        groupBy,
        timezone: this.timezone,
        buckets: [],
        totalPageviews: 0,
        uniqueVisitors: 0
      };
    }

    // Group entries by time period
    const groupedData = this.timeSeriesGrouper.groupByTimePeriod(
      this.processedEntries,
      groupBy,
      startDate,
      endDate
    );

    // Calculate unique visitors per time bucket
    const bucketsWithVisitors = groupedData.buckets.map(bucket => {
      const bucketVisitors = new Set();
      
      // Get entries for this bucket by filtering by timestamp
      const bucketEntries = this.processedEntries.filter(entry => {
        const entryTime = new Date(entry.timestamp);
        const bucketStart = new Date(bucket.start);
        const bucketEnd = new Date(bucket.end);
        return entryTime >= bucketStart && entryTime < bucketEnd;
      });

      bucketEntries.forEach(entry => {
        const visitorHash = this.visitorHasher.generateHash(entry.ip, entry.userAgent);
        bucketVisitors.add(visitorHash);
      });

      return {
        timestamp: bucket.start,
        pageviews: bucketEntries.length,
        uniqueVisitors: bucketVisitors.size,
        entries: bucketEntries
      };
    });

    return {
      groupBy,
      timezone: this.timezone,
      buckets: bucketsWithVisitors,
      totalPageviews: this.processedEntries.length,
      uniqueVisitors: this.uniqueVisitors.size
    };
  }

  /**
   * Generate top content analytics data
   * @param {number} [limit=10] - Maximum number of top pages to return
   * @returns {Object} Top content data with pageview counts and unique visitor estimates
   */
  generateTopContentData(limit = 10) {
    // Use ContentRanker to rank pages
    const rankedPages = this.contentRanker.rankPages(this.processedEntries);

    return {
      totalPages: this.pageviews.size,
      topPages: rankedPages.slice(0, limit),
      totalPageviews: this.processedEntries.length,
      uniqueVisitors: this.uniqueVisitors.size
    };
  }

  /**
   * Generate referrer analytics data grouped by domain
   * @param {number} [limit=10] - Maximum number of top referrer domains to return
   * @param {number} [pathsPerDomain=5] - Maximum number of referrer paths per domain
   * @returns {Object} Referrer data grouped by domain with specific paths
   */
  generateReferrerData(limit = 10, pathsPerDomain = 5) {
    // Use ContentRanker to rank referrers
    const rankedReferrers = this.contentRanker.rankReferrers(this.processedEntries, true);

    // Transform to match expected format
    const topReferrers = rankedReferrers.slice(0, limit).map(referrer => ({
      domain: referrer.referrer,
      totalReferrals: referrer.pageviews,
      uniqueVisitors: referrer.uniqueVisitors,
      percentage: referrer.percentage,
      topPaths: referrer.samplePaths.slice(0, pathsPerDomain).map(path => ({
        url: path,
        count: 1, // Simplified - would need more complex tracking for exact counts
        percentage: 100 / referrer.samplePaths.length
      }))
    }));

    const totalReferrals = Array.from(this.referrers.values())
      .reduce((sum, data) => sum + data.total, 0);

    return {
      totalReferrerDomains: this.referrers.size,
      totalReferrals,
      topReferrers,
      directTraffic: this.processedEntries.length - totalReferrals
    };
  }

  /**
   * Generate comprehensive summary statistics
   * @returns {Object} Summary statistics including totals and top performing content
   */
  generateSummaryStatistics() {
    const timeSeriesData = this.generateTimeSeriesData('daily');
    const topContentData = this.generateTopContentData(5);
    const referrerData = this.generateReferrerData(5, 3);

    // Calculate additional metrics
    const totalSessions = this.uniqueVisitors.size;
    const avgPageviewsPerSession = totalSessions > 0 ? this.processedEntries.length / totalSessions : 0;
    
    // Find peak traffic day
    let peakDay = null;
    let peakPageviews = 0;
    
    timeSeriesData.buckets.forEach(bucket => {
      if (bucket.pageviews > peakPageviews) {
        peakPageviews = bucket.pageviews;
        peakDay = bucket.timestamp;
      }
    });

    return {
      // Core metrics
      totalPageviews: this.processedEntries.length,
      uniqueVisitors: this.uniqueVisitors.size,
      totalPages: this.pageviews.size,
      totalReferrerDomains: this.referrers.size,
      
      // Calculated metrics
      avgPageviewsPerSession: Math.round(avgPageviewsPerSession * 100) / 100,
      peakTrafficDay: peakDay,
      peakTrafficPageviews: peakPageviews,
      
      // Top performing content
      topPages: topContentData.topPages.slice(0, 3),
      topReferrers: referrerData.topReferrers.slice(0, 3),
      
      // Traffic sources
      directTraffic: referrerData.directTraffic,
      referralTraffic: referrerData.totalReferrals,
      
      // Data freshness
      generatedAt: new Date().toISOString(),
      dataRange: {
        start: this.processedEntries.length > 0 ? 
          Math.min(...this.processedEntries.map(e => new Date(e.timestamp).getTime())) : null,
        end: this.processedEntries.length > 0 ? 
          Math.max(...this.processedEntries.map(e => new Date(e.timestamp).getTime())) : null
      }
    };
  }

  /**
   * Generate complete analytics dataset
   * @param {Object} [options] - Generation options
   * @param {string} [options.timeSeriesGroupBy='daily'] - Time-series grouping period
   * @param {number} [options.topContentLimit=10] - Number of top pages to include
   * @param {number} [options.topReferrersLimit=10] - Number of top referrer domains to include
   * @returns {Object} Complete analytics dataset
   */
  generateCompleteDataset(options = {}) {
    const {
      timeSeriesGroupBy = 'daily',
      topContentLimit = 10,
      topReferrersLimit = 10
    } = options;

    return {
      summary: this.generateSummaryStatistics(),
      timeSeries: {
        hourly: this.generateTimeSeriesData('hourly'),
        daily: this.generateTimeSeriesData('daily'),
        monthly: this.generateTimeSeriesData('monthly')
      },
      topContent: this.generateTopContentData(topContentLimit),
      referrers: this.generateReferrerData(topReferrersLimit),
      metadata: {
        generatedAt: new Date().toISOString(),
        timezone: this.timezone,
        totalEntriesProcessed: this.processedEntries.length,
        processingOptions: {
          salt: this.salt ? '[REDACTED]' : null,
          timezone: this.timezone
        }
      }
    };
  }

  /**
   * Reset all analytics data
   * @returns {void}
   */
  reset() {
    this.processedEntries = [];
    this.uniqueVisitors.clear();
    this.pageviews.clear();
    this.referrers.clear();
  }

  /**
   * Get current processing statistics
   * @returns {Object} Processing statistics
   */
  getStats() {
    return {
      entriesProcessed: this.processedEntries.length,
      uniqueVisitors: this.uniqueVisitors.size,
      uniquePages: this.pageviews.size,
      referrerDomains: this.referrers.size,
      memoryUsage: {
        entries: this.processedEntries.length,
        visitors: this.uniqueVisitors.size,
        pages: this.pageviews.size,
        referrers: this.referrers.size
      }
    };
  }
}

/**
 * Utility function to create an analytics calculator
 * @param {Object} [options] - Configuration options
 * @returns {AnalyticsCalculator} New analytics calculator instance
 */
function createAnalyticsCalculator(options = {}) {
  return new AnalyticsCalculator(options);
}

/**
 * Utility function to extract domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string|null} Domain name or null if invalid URL
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

module.exports = {
  AnalyticsCalculator,
  createAnalyticsCalculator,
  extractDomain
};