/**
 * @fileoverview Content ranking algorithms for analytics
 * Feature: metrona-analytics-system, Requirements 1.4
 */

/**
 * Content ranking utility for analyzing popular pages and referrers
 */
class ContentRanker {
  /**
   * @param {Object} [options] - Configuration options
   * @param {number} [options.maxResults=20] - Maximum number of results to return
   * @param {string[]} [options.excludePatterns=[]] - Patterns to exclude from ranking
   * @param {boolean} [options.filterStaticAssets=true] - Whether to filter out static assets
   */
  constructor(options = {}) {
    this.maxResults = options.maxResults || 20;
    this.excludePatterns = options.excludePatterns || [];
    this.filterStaticAssets = options.filterStaticAssets !== false;
    /** The site's own hostnames: a referrer from one of them is internal navigation, not a referral. */
    this.ownDomains = (options.ownDomains || []).map(d => String(d).toLowerCase());
    
    // Default static asset extensions to exclude
    this.staticAssetExtensions = [
      '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', 
      '.woff', '.woff2', '.ttf', '.eot', '.otf', '.pdf', '.zip', '.tar', 
      '.gz', '.mp4', '.mp3', '.avi', '.mov', '.wmv', '.flv', '.webm', 
      '.ogg', '.wav', '.xml', '.txt', '.json'
    ];
    
    // Default admin/system paths to exclude
    this.adminPatterns = [
      '/admin', '/wp-admin', '/wp-content', '/wp-includes',
      '/api', '/.well-known', '/robots.txt', '/sitemap.xml',
      '/favicon.ico', '/apple-touch-icon'
    ];
  }

  /**
   * Rank pages by traffic volume (pageviews)
   * @param {import('@metrona/shared').LogEntry[]} entries - Log entries to analyze
   * @param {string} [metric='pageviews'] - Metric to rank by ('pageviews' or 'uniqueVisitors')
   * @returns {Array} Ranked pages with traffic data
   */
  rankPages(entries, metric = 'pageviews') {
    if (!entries || entries.length === 0) {
      return [];
    }

    // Filter entries to only include pageviews
    const pageviewEntries = entries.filter(entry => this.isPageview(entry));
    
    // Filter out excluded paths
    const filteredEntries = pageviewEntries.filter(entry => 
      this.shouldIncludePath(entry.path)
    );

    // Group by path and calculate metrics
    const pathStats = new Map();
    
    filteredEntries.forEach(entry => {
      const path = entry.path;
      
      if (!pathStats.has(path)) {
        pathStats.set(path, {
          path,
          pageviews: 0,
          uniqueVisitors: new Set(),
          bytes: 0,
          firstSeen: entry.timestamp,
          lastSeen: entry.timestamp
        });
      }
      
      const stats = pathStats.get(path);
      stats.pageviews++;
      stats.bytes += entry.bytes || 0;
      
      // Track unique visitors using visitor hash
      const visitorHash = this.getVisitorHash(entry);
      if (visitorHash) {
        stats.uniqueVisitors.add(visitorHash);
      }
      
      // Update time range
      if (entry.timestamp < stats.firstSeen) {
        stats.firstSeen = entry.timestamp;
      }
      if (entry.timestamp > stats.lastSeen) {
        stats.lastSeen = entry.timestamp;
      }
    });

    // Convert to array and add computed metrics
    const rankedPages = Array.from(pathStats.values()).map(stats => ({
      path: stats.path,
      pageviews: stats.pageviews,
      uniqueVisitors: stats.uniqueVisitors.size,
      bytes: stats.bytes,
      avgBytesPerView: stats.pageviews > 0 ? Math.round(stats.bytes / stats.pageviews) : 0,
      firstSeen: stats.firstSeen.toISOString(),
      lastSeen: stats.lastSeen.toISOString(),
      // Calculate percentage of total filtered pageviews
      percentage: filteredEntries.length > 0 ? 
        Math.round((stats.pageviews / filteredEntries.length) * 10000) / 100 : 0
    }));

    // Sort by the specified metric, with path as secondary sort for stability
    rankedPages.sort((a, b) => {
      if (metric === 'uniqueVisitors') {
        if (b.uniqueVisitors !== a.uniqueVisitors) {
          return b.uniqueVisitors - a.uniqueVisitors;
        }
      } else {
        if (b.pageviews !== a.pageviews) {
          return b.pageviews - a.pageviews; // Default to pageviews
        }
      }
      // Secondary sort by path for stable ordering
      return a.path.localeCompare(b.path);
    });

    // Return top results
    return rankedPages.slice(0, this.maxResults);
  }

  /**
   * Rank referrers by traffic volume
   * @param {import('@metrona/shared').LogEntry[]} entries - Log entries to analyze
   * @param {boolean} [groupByDomain=true] - Whether to group by domain or keep full URLs
   * @returns {Array} Ranked referrers with traffic data
   */
  rankReferrers(entries, groupByDomain = true) {
    if (!entries || entries.length === 0) {
      return [];
    }

    // Filter entries to only include pageviews with valid referrers
    const pageviewEntries = entries.filter(entry => 
      this.isPageview(entry) && 
      entry.referrer && 
      entry.referrer !== '-' && 
      !this.isInternalReferrer(entry.referrer)
    );

    // Group by referrer (domain or full URL)
    const referrerStats = new Map();
    
    pageviewEntries.forEach(entry => {
      const referrer = groupByDomain ? 
        this.extractDomain(entry.referrer) : 
        entry.referrer;
      
      if (!referrer || referrer === 'unknown') {
        return;
      }
      
      if (!referrerStats.has(referrer)) {
        referrerStats.set(referrer, {
          referrer,
          pageviews: 0,
          uniqueVisitors: new Set(),
          firstSeen: entry.timestamp,
          lastSeen: entry.timestamp,
          // Track sample paths that were visited from this referrer
          samplePaths: new Set()
        });
      }
      
      const stats = referrerStats.get(referrer);
      stats.pageviews++;
      
      // Track unique visitors
      const visitorHash = this.getVisitorHash(entry);
      if (visitorHash) {
        stats.uniqueVisitors.add(visitorHash);
      }
      
      // Update time range
      if (entry.timestamp < stats.firstSeen) {
        stats.firstSeen = entry.timestamp;
      }
      if (entry.timestamp > stats.lastSeen) {
        stats.lastSeen = entry.timestamp;
      }
      
      // Track sample paths (limit to 5 for performance)
      if (stats.samplePaths.size < 5) {
        stats.samplePaths.add(entry.path);
      }
    });

    // Convert to array and add computed metrics
    const rankedReferrers = Array.from(referrerStats.values()).map(stats => ({
      referrer: stats.referrer,
      pageviews: stats.pageviews,
      uniqueVisitors: stats.uniqueVisitors.size,
      firstSeen: stats.firstSeen.toISOString(),
      lastSeen: stats.lastSeen.toISOString(),
      samplePaths: Array.from(stats.samplePaths),
      // Calculate percentage of total referrer traffic
      percentage: pageviewEntries.length > 0 ? 
        Math.round((stats.pageviews / pageviewEntries.length) * 10000) / 100 : 0
    }));

    // Sort by pageviews with referrer as secondary sort for stability
    rankedReferrers.sort((a, b) => {
      if (b.pageviews !== a.pageviews) {
        return b.pageviews - a.pageviews;
      }
      // Secondary sort by referrer for stable ordering
      return a.referrer.localeCompare(b.referrer);
    });

    // Return top results
    return rankedReferrers.slice(0, this.maxResults);
  }

  /**
   * Get top content across multiple metrics
   * @param {import('@metrona/shared').LogEntry[]} entries - Log entries to analyze
   * @returns {Object} Object containing top pages and referrers
   */
  getTopContent(entries) {
    return {
      topPages: this.rankPages(entries, 'pageviews'),
      topPagesByVisitors: this.rankPages(entries, 'uniqueVisitors'),
      topReferrers: this.rankReferrers(entries, true),
      topReferrerUrls: this.rankReferrers(entries, false)
    };
  }

  /**
   * Check if entry is a pageview (same logic as TimeSeriesGrouper)
   * @param {Object} entry - Log entry
   * @returns {boolean} True if pageview
   * @private
   */
  isPageview(entry) {
    const PAGEVIEW_CODES = [200, 201, 202, 203, 204, 205, 206, 300, 301, 302, 303, 304, 307, 308];
    
    if (!PAGEVIEW_CODES.includes(entry.status)) {
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
   * Check if a path should be included in ranking
   * @param {string} path - URL path
   * @returns {boolean} True if path should be included
   * @private
   */
  shouldIncludePath(path) {
    if (!path || path === '/') {
      return true; // Always include root path
    }

    const lowerPath = path.toLowerCase();

    // Filter out static assets
    if (this.filterStaticAssets) {
      const hasStaticExtension = this.staticAssetExtensions.some(ext => 
        lowerPath.endsWith(ext)
      );
      if (hasStaticExtension) {
        return false;
      }
    }

    // Filter out admin paths
    const isAdminPath = this.adminPatterns.some(pattern => 
      lowerPath.startsWith(pattern.toLowerCase())
    );
    if (isAdminPath) {
      return false;
    }

    // Filter out custom exclude patterns
    const matchesExcludePattern = this.excludePatterns.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(path);
      }
      return lowerPath.includes(pattern.toLowerCase());
    });
    if (matchesExcludePattern) {
      return false;
    }

    return true;
  }

  /**
   * Extract domain from referrer URL
   * @param {string} referrer - Referrer URL
   * @returns {string|null} Domain or null if invalid
   * @private
   */
  extractDomain(referrer) {
    if (!referrer || referrer === '-') {
      return null;
    }

    try {
      // Handle cases where referrer might not have protocol
      let url = referrer;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'http://' + url;
      }
      
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (error) {
      // If URL parsing fails, try to extract domain manually
      const match = referrer.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s]+)/);
      return match ? match[1] : 'unknown';
    }
  }

  /**
   * Check if referrer is internal (same domain)
   * @param {string} referrer - Referrer URL
   * @returns {boolean} True if internal referrer
   * @private
   */
  isInternalReferrer(referrer) {
    if (!referrer || referrer === '-') {
      return true;
    }

    // This is a simplified check - in a real implementation,
    // you'd compare against the site's actual domain
    const domain = this.extractDomain(referrer);
    
    // Consider localhost and common development domains as internal
    const internalDomains = ['localhost', '127.0.0.1', '0.0.0.0', ...this.ownDomains];
    return internalDomains.includes(String(domain).toLowerCase());
  }

  /**
   * Get visitor hash from entry (same logic as TimeSeriesGrouper)
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
}

/**
 * Convenience function for ranking pages
 * @param {Array} entries - Log entries
 * @param {string} [metric='pageviews'] - Metric to rank by
 * @param {Object} [options] - Ranking options
 * @returns {Array} Ranked pages
 */
function rankPages(entries, metric = 'pageviews', options = {}) {
  const ranker = new ContentRanker(options);
  return ranker.rankPages(entries, metric);
}

/**
 * Convenience function for ranking referrers
 * @param {Array} entries - Log entries
 * @param {boolean} [groupByDomain=true] - Whether to group by domain
 * @param {Object} [options] - Ranking options
 * @returns {Array} Ranked referrers
 */
function rankReferrers(entries, groupByDomain = true, options = {}) {
  const ranker = new ContentRanker(options);
  return ranker.rankReferrers(entries, groupByDomain);
}

/**
 * Convenience function for getting all top content
 * @param {Array} entries - Log entries
 * @param {Object} [options] - Ranking options
 * @returns {Object} Top content across all metrics
 */
function getTopContent(entries, options = {}) {
  const ranker = new ContentRanker(options);
  return ranker.getTopContent(entries);
}

module.exports = {
  ContentRanker,
  rankPages,
  rankReferrers,
  getTopContent
};