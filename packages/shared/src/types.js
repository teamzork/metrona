/**
 * @fileoverview Shared type definitions and data structures for Metrona Analytics System
 */

/**
 * @typedef {Object} LogEntry
 * @property {Date} timestamp - When the request occurred
 * @property {string} ip - Client IP address (will be hashed for privacy)
 * @property {string} method - HTTP method (GET, POST, etc.)
 * @property {string} path - Request path
 * @property {number} status - HTTP status code
 * @property {number} bytes - Response size in bytes
 * @property {string} referrer - Referrer URL
 * @property {string} userAgent - User agent string (will be hashed for privacy)
 * @property {number} responseTime - Response time in seconds
 */

/**
 * @typedef {Object} SiteConfig
 * @property {string} domain - Site domain name
 * @property {string} nginxConfig - Path to nginx configuration file
 * @property {string} logPath - Path to nginx access log file
 * @property {string} frequency - Processing frequency (daily, hourly, or cron expression)
 * @property {boolean} enabled - Whether site is enabled for processing
 * @property {string[]} [exclusions] - URL patterns to exclude from analytics
 */

/**
 * @typedef {Object} AnalyticsConfig
 * @property {number} version - Configuration version
 * @property {Object} storage - Storage configuration
 * @property {string} storage.dataPath - Path to store analytics data
 * @property {boolean} storage.backupEnabled - Whether to enable backups
 * @property {number} [storage.retentionDays] - Data retention period in days
 * @property {Object} dashboard - Dashboard configuration
 * @property {boolean} dashboard.enabled - Whether dashboard is enabled
 * @property {number} dashboard.port - Dashboard port number
 * @property {string} dashboard.passwordHash - Bcrypt password hash
 * @property {number} [dashboard.rateLimit] - Rate limit for authentication attempts
 * @property {SiteConfig[]} sites - Array of site configurations
 */

/**
 * @typedef {Object} TimeSeriesData
 * @property {string} start - Start timestamp (ISO string)
 * @property {string} end - End timestamp (ISO string)
 * @property {number} pageviews - Total pageviews in period
 * @property {number} uniqueVisitors - Unique visitors in period
 * @property {Array<{hour: number, pageviews: number, uniqueVisitors: number}>} [hourly] - Hourly breakdown
 * @property {Array<{date: string, pageviews: number, uniqueVisitors: number}>} [daily] - Daily breakdown
 */

/**
 * @typedef {Object} TopPage
 * @property {string} path - Page path
 * @property {number} pageviews - Number of pageviews
 * @property {number} uniqueVisitors - Number of unique visitors
 * @property {number} [bounceRate] - Bounce rate (0-1)
 */

/**
 * @typedef {Object} TopReferrer
 * @property {string} domain - Referrer domain
 * @property {number} pageviews - Number of pageviews from this referrer
 * @property {number} uniqueVisitors - Number of unique visitors from this referrer
 * @property {Array<{path: string, pageviews: number}>} [paths] - Top referrer paths
 */

/**
 * @typedef {Object} SiteSection
 * @property {string} name - Section name
 * @property {string} pattern - URL pattern (glob-style)
 * @property {number} pageviews - Pageviews in this section
 * @property {number} uniqueVisitors - Unique visitors in this section
 */

/**
 * @typedef {Object} AnalyticsSummary
 * @property {number} totalPageviews - Total pageviews
 * @property {number} uniqueVisitors - Total unique visitors
 * @property {string} topPage - Most popular page path
 * @property {string} topReferrer - Top referrer domain
 * @property {number} [bounceRate] - Overall bounce rate
 * @property {number} [avgSessionDuration] - Average session duration in seconds
 */

/**
 * @typedef {Object} AnalyticsData
 * @property {string} generatedAt - Generation timestamp (ISO string)
 * @property {string} site - Site domain
 * @property {number} version - Data format version
 * @property {AnalyticsSummary} summary - Summary statistics
 * @property {Object} timeframes - Time-series data for different periods
 * @property {TimeSeriesData} timeframes.day_1 - Last 24 hours
 * @property {TimeSeriesData} timeframes.day_7 - Last 7 days
 * @property {TimeSeriesData} timeframes.day_30 - Last 30 days
 * @property {TimeSeriesData} timeframes.day_365 - Last 365 days
 * @property {TimeSeriesData} timeframes.all_time - All time data
 * @property {TopPage[]} topPages - Top pages by traffic
 * @property {TopReferrer[]} topReferrers - Top referrers by traffic
 * @property {SiteSection[]} [sections] - Site sections breakdown
 */

module.exports = {
  // Export types for JSDoc usage - actual types are in the @typedef comments above
};