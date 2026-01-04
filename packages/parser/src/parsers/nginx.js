/**
 * @fileoverview nginx log format parser implementation
 */

const BaseParser = require('./base');

// Local constants to avoid shared package dependency issues
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

const ERROR_CODES = {
  LOG_PARSE_ERROR: 'LOG_PARSE_ERROR'
};

/**
 * LogEntry class representing a parsed nginx log entry
 */
class LogEntry {
  /**
   * @param {Object} data - Raw log entry data
   * @param {Date} data.timestamp - Request timestamp
   * @param {string} data.ip - Client IP address
   * @param {string} data.method - HTTP method
   * @param {string} data.path - Request path
   * @param {number} data.status - HTTP status code
   * @param {number} data.bytes - Response size in bytes
   * @param {string} data.referrer - Referrer URL
   * @param {string} data.userAgent - User agent string
   * @param {number} [data.responseTime] - Response time in seconds
   */
  constructor(data) {
    this.timestamp = data.timestamp;
    this.ip = data.ip;
    this.method = data.method;
    this.path = data.path;
    this.status = data.status;
    this.bytes = data.bytes;
    this.referrer = data.referrer;
    this.userAgent = data.userAgent;
    this.responseTime = data.responseTime || 0;
  }

  /**
   * Check if this entry represents a pageview
   * @returns {boolean} True if this is a pageview
   */
  isPageview() {
    const parser = new NginxLogParser(''); // Temporary instance for utility methods
    return parser.isPageview(this);
  }

  /**
   * Generate privacy-preserving visitor hash
   * @returns {string} Visitor hash
   */
  getVisitorHash() {
    const parser = new NginxLogParser(''); // Temporary instance for utility methods
    return parser.generateVisitorHash(this.ip, this.userAgent);
  }

  /**
   * Extract referrer domain
   * @param {string} ownDomain - Own domain to exclude
   * @returns {string} Referrer domain
   */
  getReferrerDomain(ownDomain) {
    const parser = new NginxLogParser(''); // Temporary instance for utility methods
    return parser.extractReferrerDomain(this.referrer, ownDomain);
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object} Plain object representation
   */
  toObject() {
    return {
      timestamp: this.timestamp.toISOString(),
      ip: this.ip,
      method: this.method,
      path: this.path,
      status: this.status,
      bytes: this.bytes,
      referrer: this.referrer,
      userAgent: this.userAgent,
      responseTime: this.responseTime
    };
  }
}

/**
 * nginx log parser implementation
 */
class NginxLogParser extends BaseParser {
  /**
   * @param {string} logPath - Path to nginx log file
   * @param {number} [lastPosition=0] - Last known position in file
   * @param {string} [format='combined'] - Log format (combined or analytics)
   */
  constructor(logPath, lastPosition = 0, format = 'combined') {
    super(logPath, lastPosition);
    this.format = format;
    this.regex = format === 'analytics' ? LOG_FORMATS.ANALYTICS : LOG_FORMATS.COMBINED;
  }

  /**
   * Parse a single nginx log line
   * @param {string} line - Raw log line
   * @returns {LogEntry|null} Parsed log entry or null if invalid
   */
  parseLine(line) {
    if (!line || line.trim() === '') {
      return null;
    }

    const match = line.match(this.regex);
    if (!match) {
      // Log parsing error but don't throw - skip invalid lines
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`Failed to parse log line: ${line.substring(0, 100)}...`);
      }
      return null;
    }

    try {
      const fields = LOG_FORMATS.FIELDS;
      
      // Extract basic fields
      const ip = match[fields.IP] || '';
      const user = match[fields.USER] || '';
      const timestampStr = match[fields.TIMESTAMP] || '';
      const requestStr = match[fields.REQUEST] || '';
      const status = parseInt(match[fields.STATUS]) || 0;
      const bytes = parseInt(match[fields.BYTES]) || 0;
      const referrer = match[fields.REFERRER] || '';
      const userAgent = match[fields.USER_AGENT] || '';
      const responseTime = this.format === 'analytics' ? 
        parseFloat(match[fields.RESPONSE_TIME]) || 0 : 0;

      // Parse timestamp
      const timestamp = this.parseTimestamp(timestampStr);

      // Parse request to get method and path
      const { method, path } = this.parseRequest(requestStr);

      // Create LogEntry instance
      return new LogEntry({
        timestamp,
        ip,
        method,
        path,
        status,
        bytes,
        referrer,
        userAgent,
        responseTime
      });

    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`Error parsing log line: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Parse multiple log lines
   * @param {string[]} lines - Array of log lines
   * @returns {LogEntry[]} Array of parsed log entries
   */
  parseLines(lines) {
    const entries = [];
    
    for (const line of lines) {
      const entry = this.parseLine(line);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Validate log format by testing a sample line
   * @param {string} sampleLine - Sample log line to test
   * @returns {boolean} True if format is valid
   */
  validateFormat(sampleLine) {
    const entry = this.parseLine(sampleLine);
    return entry !== null;
  }

  /**
   * Get supported log formats
   * @returns {string[]} Array of supported format names
   */
  static getSupportedFormats() {
    return ['combined', 'analytics'];
  }

  /**
   * Auto-detect log format from sample lines
   * @param {string[]} sampleLines - Sample log lines
   * @returns {string} Detected format name
   */
  static detectFormat(sampleLines) {
    const formats = ['analytics', 'combined'];
    
    for (const format of formats) {
      const parser = new NginxLogParser('', 0, format);
      let successCount = 0;
      
      for (const line of sampleLines.slice(0, 5)) { // Test first 5 lines
        if (parser.parseLine(line)) {
          successCount++;
        }
      }
      
      // If more than half the lines parse successfully, use this format
      if (successCount > sampleLines.length / 2) {
        return format;
      }
    }
    
    // Default to combined format
    return 'combined';
  }
}

module.exports = { NginxLogParser, LogEntry };