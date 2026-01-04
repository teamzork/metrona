/**
 * @fileoverview Shared constants for Metrona Analytics System
 */

/**
 * Default configuration values
 */
const DEFAULTS = {
  // Configuration file paths
  CONFIG_PATH: '/etc/analytics/config.yaml',
  DATA_PATH: '/var/analytics/data',
  LOG_PATH: '/var/log/analytics-scheduler.log',
  
  // Dashboard defaults
  DASHBOARD_PORT: 3001,
  DASHBOARD_RATE_LIMIT: 10, // requests per minute
  
  // Security defaults
  BCRYPT_ROUNDS: 12,
  SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  
  // Processing defaults
  DEFAULT_FREQUENCY: 'daily',
  MAX_TOP_ITEMS: 20,
  DATA_RETENTION_DAYS: 365,
  
  // Performance limits
  MAX_MEMORY_MB: 512,
  STREAM_CHUNK_SIZE: 64 * 1024, // 64KB
  MAX_LOG_FILE_SIZE: 1024 * 1024 * 1024, // 1GB
  
  // File permissions
  CONFIG_FILE_MODE: 0o600, // Owner read/write only
  DATA_FILE_MODE: 0o644,   // Owner read/write, group/others read
  LOG_FILE_MODE: 0o644,
};

/**
 * nginx log format patterns
 */
const LOG_FORMATS = {
  // Standard combined log format
  COMBINED: /^(\S+) - (\S+) \[([^\]]+)\] "([^"]*)" (\d+) (\d+) "([^"]*)" "([^"]*)"/,
  
  // Custom analytics format with response time
  ANALYTICS: /^(\S+) - (\S+) \[([^\]]+)\] "([^"]*)" (\d+) (\d+) "([^"]*)" "([^"]*)" ([\d.]+)/,
  
  // Field positions for parsing
  FIELDS: {
    IP: 1,
    USER: 2,
    TIMESTAMP: 3,
    REQUEST: 4,
    STATUS: 5,
    BYTES: 6,
    REFERRER: 7,
    USER_AGENT: 8,
    RESPONSE_TIME: 9
  }
};

/**
 * HTTP status code categories
 */
const HTTP_STATUS = {
  SUCCESS: [200, 201, 202, 203, 204, 205, 206],
  REDIRECT: [300, 301, 302, 303, 304, 307, 308],
  CLIENT_ERROR: [400, 401, 403, 404, 405, 406, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 422, 423, 424, 426, 428, 429, 431, 451],
  SERVER_ERROR: [500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511],
  
  // Status codes that count as pageviews
  PAGEVIEW_CODES: [200, 201, 202, 203, 204, 205, 206, 300, 301, 302, 303, 304, 307, 308]
};

/**
 * File extensions to exclude from analytics (static assets)
 */
const EXCLUDED_EXTENSIONS = [
  '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2',
  '.ttf', '.eot', '.otf', '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3', '.avi',
  '.mov', '.wmv', '.flv', '.webm', '.ogg', '.wav', '.xml', '.txt', '.json'
];

/**
 * Common bot user agents to exclude (optional filtering)
 */
const BOT_USER_AGENTS = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot',
  'facebookexternalhit', 'twitterbot', 'linkedinbot', 'whatsapp', 'telegrambot',
  'crawler', 'spider', 'bot', 'scraper', 'monitor', 'checker'
];

/**
 * Time period definitions in milliseconds
 */
const TIME_PERIODS = {
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
  YEAR: 365 * 24 * 60 * 60 * 1000
};

/**
 * Supported cron frequency shortcuts
 */
const CRON_FREQUENCIES = {
  'hourly': '0 * * * *',
  'daily': '0 0 * * *',
  'weekly': '0 0 * * 0',
  'monthly': '0 0 1 * *'
};

/**
 * Error codes for different types of failures
 */
const ERROR_CODES = {
  // Configuration errors
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  CONFIG_PERMISSION_DENIED: 'CONFIG_PERMISSION_DENIED',
  
  // File system errors
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_PERMISSION_DENIED: 'FILE_PERMISSION_DENIED',
  DISK_SPACE_FULL: 'DISK_SPACE_FULL',
  
  // Processing errors
  LOG_PARSE_ERROR: 'LOG_PARSE_ERROR',
  MEMORY_LIMIT_EXCEEDED: 'MEMORY_LIMIT_EXCEEDED',
  YAML_GENERATION_FAILED: 'YAML_GENERATION_FAILED',
  
  // Network errors
  AUTH_FAILED: 'AUTH_FAILED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  NETWORK_ERROR: 'NETWORK_ERROR'
};

module.exports = {
  DEFAULTS,
  LOG_FORMATS,
  HTTP_STATUS,
  EXCLUDED_EXTENSIONS,
  BOT_USER_AGENTS,
  TIME_PERIODS,
  CRON_FREQUENCIES,
  ERROR_CODES
};