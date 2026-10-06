/**
 * @fileoverview Abstract base parser interface for different log formats
 */

/**
 * Abstract base class for log parsers
 */
class BaseParser {
  /**
   * @param {string} logPath - Path to the log file
   * @param {number} [lastPosition=0] - Last known position in the file
   */
  constructor(logPath, lastPosition = 0) {
    if (this.constructor === BaseParser) {
      throw new Error('BaseParser is abstract and cannot be instantiated directly');
    }
    
    this.logPath = logPath;
    this.lastPosition = lastPosition;
  }

  /**
   * Parse a single log line into a LogEntry object
   * @param {string} line - Raw log line
   * @returns {import('@analytics-system/shared').LogEntry|null} Parsed log entry or null if invalid
   * @abstract
   */
  parseLine(line) {
    throw new Error('parseLine must be implemented by subclass');
  }

  /**
   * Validate that a log entry represents a pageview
   * @param {import('@analytics-system/shared').LogEntry} entry - Log entry to validate
   * @returns {boolean} True if entry is a valid pageview
   */
  isPageview(entry) {
    // Local constants to avoid shared package dependency issues
    const PAGEVIEW_CODES = [200, 201, 202, 203, 204, 205, 206, 300, 301, 302, 303, 304, 307, 308];
    const EXCLUDED_EXTENSIONS = [
      '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2',
      '.ttf', '.eot', '.otf', '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3', '.avi',
      '.mov', '.wmv', '.flv', '.webm', '.ogg', '.wav', '.xml', '.txt', '.json'
    ];
    
    // Check if status code indicates a successful pageview
    if (!PAGEVIEW_CODES.includes(entry.status)) {
      return false;
    }

    // Check if path has excluded extension
    const path = entry.path.toLowerCase();
    const hasExcludedExtension = EXCLUDED_EXTENSIONS.some(ext => 
      path.endsWith(ext.toLowerCase())
    );
    
    if (hasExcludedExtension) {
      return false;
    }

    // Check if it's a valid HTTP method for pageviews
    const validMethods = ['GET', 'HEAD'];
    if (!validMethods.includes(entry.method)) {
      return false;
    }

    return true;
  }

  /**
   * Generate a privacy-preserving visitor hash
   * @param {string} ip - IP address
   * @param {string} userAgent - User agent string
   * @returns {string} SHA-256 hash of IP + User Agent
   */
  generateVisitorHash(ip, userAgent) {
    const { generateVisitorHash } = require('../utils/visitor-hash');
    return generateVisitorHash(ip, userAgent);
  }

  /**
   * Extract domain from referrer URL
   * @param {string} referrer - Referrer URL
   * @param {string} ownDomain - Own domain to exclude
   * @returns {string} Referrer domain or 'direct' if no referrer
   */
  extractReferrerDomain(referrer, ownDomain) {
    if (!referrer || referrer === '-' || referrer === '') {
      return 'direct';
    }

    try {
      const url = new URL(referrer);
      const domain = url.hostname.toLowerCase();
      
      // Exclude own domain
      if (domain === ownDomain.toLowerCase()) {
        return 'direct';
      }
      
      return domain;
    } catch (error) {
      return 'direct';
    }
  }

  /**
   * Parse timestamp from nginx log format
   * @param {string} timestamp - Timestamp string from nginx log
   * @returns {Date} Parsed date object
   */
  parseTimestamp(timestamp) {
    // nginx timestamp format: [04/Jan/2026:12:00:00 +0000]
    // Remove brackets and parse
    const cleanTimestamp = timestamp.replace(/[\[\]]/g, '');
    
    // Convert to ISO format for parsing
    const parts = cleanTimestamp.split(' ');
    if (parts.length !== 2) {
      throw new Error(`Invalid timestamp format: ${timestamp}`);
    }
    
    const datePart = parts[0];
    const timezonePart = parts[1];
    
    // Parse date part: 04/Jan/2026:12:00:00
    const dateMatch = datePart.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
    if (!dateMatch) {
      throw new Error(`Invalid date format: ${datePart}`);
    }
    
    const [, day, monthName, year, hour, minute, second] = dateMatch;
    
    // Convert month name to number
    const months = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
      'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };
    
    const month = months[monthName];
    if (month === undefined) {
      throw new Error(`Invalid month name: ${monthName}`);
    }
    
    // The fields are wall-clock time at the logged offset: read them as UTC, then subtract the
    // offset. (Building a local-time Date made results depend on the server's TZ.)
    const offsetMatch = timezonePart.match(/^([+-])(\d{2})(\d{2})$/);
    if (!offsetMatch) {
      throw new Error(`Invalid timezone offset: ${timezonePart}`);
    }
    const [, sign, offHours, offMinutes] = offsetMatch;
    const offsetMs = (parseInt(offHours) * 60 + parseInt(offMinutes)) * 60000 * (sign === '+' ? 1 : -1);
    const date = new Date(
      Date.UTC(parseInt(year), month, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second)) - offsetMs
    );
    
    return date;
  }

  /**
   * Parse HTTP request string to extract method and path
   * @param {string} request - HTTP request string (e.g., "GET /path HTTP/1.1")
   * @returns {{method: string, path: string}} Parsed method and path
   */
  parseRequest(request) {
    if (!request || request === '-') {
      return { method: 'UNKNOWN', path: '/' };
    }

    // Parse request: "GET /path?query HTTP/1.1"
    const parts = request.split(' ');
    if (parts.length < 2) {
      return { method: 'UNKNOWN', path: '/' };
    }

    const method = parts[0];
    let path = parts[1];

    // Remove query parameters for cleaner analytics
    const queryIndex = path.indexOf('?');
    if (queryIndex !== -1) {
      path = path.substring(0, queryIndex);
    }

    // Ensure path starts with /
    if (!path.startsWith('/')) {
      path = '/' + path;
    }

    return { method, path };
  }
}

module.exports = BaseParser;