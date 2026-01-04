/**
 * @fileoverview Tests for nginx log parser
 */

const { NginxLogParser, LogEntry } = require('./nginx');

describe('NginxLogParser', () => {
  describe('parseLine', () => {
    it('should parse combined log format correctly', () => {
      const parser = new NginxLogParser('test.log', 0, 'combined');
      const logLine = '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /blog/post-123 HTTP/1.1" 200 1234 "https://google.com/search" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"';
      
      const entry = parser.parseLine(logLine);
      
      expect(entry).not.toBeNull();
      expect(entry.ip).toBe('192.168.1.1');
      expect(entry.method).toBe('GET');
      expect(entry.path).toBe('/blog/post-123');
      expect(entry.status).toBe(200);
      expect(entry.bytes).toBe(1234);
      expect(entry.referrer).toBe('https://google.com/search');
      expect(entry.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      expect(entry.timestamp).toBeInstanceOf(Date);
    });

    it('should parse analytics log format with response time', () => {
      const parser = new NginxLogParser('test.log', 0, 'analytics');
      const logLine = '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /about HTTP/1.1" 200 5678 "https://example.com/" "Mozilla/5.0" 0.123';
      
      const entry = parser.parseLine(logLine);
      
      expect(entry).not.toBeNull();
      expect(entry.responseTime).toBe(0.123);
    });

    it('should handle malformed log lines gracefully', () => {
      const parser = new NginxLogParser('test.log');
      const malformedLine = 'this is not a valid log line';
      
      const entry = parser.parseLine(malformedLine);
      
      expect(entry).toBeNull();
    });

    it('should handle empty or whitespace lines', () => {
      const parser = new NginxLogParser('test.log');
      
      expect(parser.parseLine('')).toBeNull();
      expect(parser.parseLine('   ')).toBeNull();
      expect(parser.parseLine('\n')).toBeNull();
    });

    it('should parse request with query parameters', () => {
      const parser = new NginxLogParser('test.log');
      const logLine = '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /search?q=test&page=1 HTTP/1.1" 200 1234 "-" "Mozilla/5.0"';
      
      const entry = parser.parseLine(logLine);
      
      expect(entry).not.toBeNull();
      expect(entry.path).toBe('/search'); // Query parameters should be stripped
    });

    it('should handle different HTTP methods', () => {
      const parser = new NginxLogParser('test.log');
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];
      
      methods.forEach(method => {
        const logLine = `192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "${method} /test HTTP/1.1" 200 1234 "-" "Mozilla/5.0"`;
        const entry = parser.parseLine(logLine);
        
        expect(entry).not.toBeNull();
        expect(entry.method).toBe(method);
      });
    });
  });

  describe('parseLines', () => {
    it('should parse multiple log lines', () => {
      const parser = new NginxLogParser('test.log');
      const lines = [
        '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /page1 HTTP/1.1" 200 1234 "-" "Mozilla/5.0"',
        '192.168.1.2 - - [04/Jan/2026:12:01:00 +0000] "GET /page2 HTTP/1.1" 200 5678 "-" "Mozilla/5.0"',
        'invalid line',
        '192.168.1.3 - - [04/Jan/2026:12:02:00 +0000] "GET /page3 HTTP/1.1" 200 9012 "-" "Mozilla/5.0"'
      ];
      
      const entries = parser.parseLines(lines);
      
      expect(entries).toHaveLength(3); // Should skip invalid line
      expect(entries[0].path).toBe('/page1');
      expect(entries[1].path).toBe('/page2');
      expect(entries[2].path).toBe('/page3');
    });
  });

  describe('validateFormat', () => {
    it('should validate combined format', () => {
      const parser = new NginxLogParser('test.log', 0, 'combined');
      const validLine = '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /test HTTP/1.1" 200 1234 "-" "Mozilla/5.0"';
      
      expect(parser.validateFormat(validLine)).toBe(true);
    });

    it('should reject invalid format', () => {
      const parser = new NginxLogParser('test.log', 0, 'combined');
      const invalidLine = 'this is not a valid log line';
      
      expect(parser.validateFormat(invalidLine)).toBe(false);
    });
  });

  describe('detectFormat', () => {
    it('should detect combined format', () => {
      const sampleLines = [
        '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /test HTTP/1.1" 200 1234 "-" "Mozilla/5.0"',
        '192.168.1.2 - - [04/Jan/2026:12:01:00 +0000] "GET /test2 HTTP/1.1" 200 5678 "-" "Mozilla/5.0"'
      ];
      
      const format = NginxLogParser.detectFormat(sampleLines);
      
      expect(format).toBe('combined');
    });

    it('should detect analytics format', () => {
      const sampleLines = [
        '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /test HTTP/1.1" 200 1234 "-" "Mozilla/5.0" 0.123',
        '192.168.1.2 - - [04/Jan/2026:12:01:00 +0000] "GET /test2 HTTP/1.1" 200 5678 "-" "Mozilla/5.0" 0.456'
      ];
      
      const format = NginxLogParser.detectFormat(sampleLines);
      
      expect(format).toBe('analytics');
    });
  });
});

describe('LogEntry', () => {
  const sampleData = {
    timestamp: new Date('2026-01-04T12:00:00Z'),
    ip: '192.168.1.1',
    method: 'GET',
    path: '/test',
    status: 200,
    bytes: 1234,
    referrer: 'https://google.com',
    userAgent: 'Mozilla/5.0',
    responseTime: 0.123
  };

  describe('constructor', () => {
    it('should create LogEntry with all fields', () => {
      const entry = new LogEntry(sampleData);
      
      expect(entry.timestamp).toEqual(sampleData.timestamp);
      expect(entry.ip).toBe(sampleData.ip);
      expect(entry.method).toBe(sampleData.method);
      expect(entry.path).toBe(sampleData.path);
      expect(entry.status).toBe(sampleData.status);
      expect(entry.bytes).toBe(sampleData.bytes);
      expect(entry.referrer).toBe(sampleData.referrer);
      expect(entry.userAgent).toBe(sampleData.userAgent);
      expect(entry.responseTime).toBe(sampleData.responseTime);
    });
  });

  describe('isPageview', () => {
    it('should identify valid pageviews', () => {
      const entry = new LogEntry({
        ...sampleData,
        method: 'GET',
        status: 200,
        path: '/blog/post'
      });
      
      expect(entry.isPageview()).toBe(true);
    });

    it('should reject static assets', () => {
      const entry = new LogEntry({
        ...sampleData,
        path: '/assets/style.css'
      });
      
      expect(entry.isPageview()).toBe(false);
    });

    it('should reject non-pageview status codes', () => {
      const entry = new LogEntry({
        ...sampleData,
        status: 404
      });
      
      expect(entry.isPageview()).toBe(false);
    });

    it('should reject non-GET/HEAD methods', () => {
      const entry = new LogEntry({
        ...sampleData,
        method: 'POST'
      });
      
      expect(entry.isPageview()).toBe(false);
    });
  });

  describe('getVisitorHash', () => {
    it('should generate consistent hash for same IP and user agent', () => {
      const entry1 = new LogEntry(sampleData);
      const entry2 = new LogEntry(sampleData);
      
      const hash1 = entry1.getVisitorHash();
      const hash2 = entry2.getVisitorHash();
      
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex string
    });

    it('should generate different hashes for different visitors', () => {
      const entry1 = new LogEntry(sampleData);
      const entry2 = new LogEntry({
        ...sampleData,
        ip: '192.168.1.2'
      });
      
      const hash1 = entry1.getVisitorHash();
      const hash2 = entry2.getVisitorHash();
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('getReferrerDomain', () => {
    it('should extract domain from referrer URL', () => {
      const entry = new LogEntry({
        ...sampleData,
        referrer: 'https://google.com/search?q=test'
      });
      
      const domain = entry.getReferrerDomain('example.com');
      
      expect(domain).toBe('google.com');
    });

    it('should return "direct" for empty referrer', () => {
      const entry = new LogEntry({
        ...sampleData,
        referrer: '-'
      });
      
      const domain = entry.getReferrerDomain('example.com');
      
      expect(domain).toBe('direct');
    });

    it('should return "direct" for same-domain referrer', () => {
      const entry = new LogEntry({
        ...sampleData,
        referrer: 'https://example.com/other-page'
      });
      
      const domain = entry.getReferrerDomain('example.com');
      
      expect(domain).toBe('direct');
    });
  });

  describe('toObject', () => {
    it('should convert to plain object', () => {
      const entry = new LogEntry(sampleData);
      const obj = entry.toObject();
      
      expect(obj).toEqual({
        timestamp: '2026-01-04T12:00:00.000Z',
        ip: '192.168.1.1',
        method: 'GET',
        path: '/test',
        status: 200,
        bytes: 1234,
        referrer: 'https://google.com',
        userAgent: 'Mozilla/5.0',
        responseTime: 0.123
      });
    });
  });
});