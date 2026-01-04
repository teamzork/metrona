/**
 * @fileoverview Property-based tests for nginx log parser
 * Feature: metrona-analytics-system, Property 1: Log Entry Parsing Completeness
 * **Validates: Requirements 1.1**
 */

const fc = require('fast-check');
const { NginxLogParser, LogEntry } = require('./nginx');

describe('NginxLogParser Property Tests', () => {
  describe('Property 1: Log Entry Parsing Completeness', () => {
    /**
     * Property: For any valid nginx access log entry, the parser should extract 
     * all required fields (timestamp, IP, method, path, status, bytes, referrer, user-agent) 
     * without data loss or corruption.
     * **Validates: Requirements 1.1**
     */
    it('should extract all required fields from any valid nginx log entry', () => {
      // Generator for valid IP addresses
      const ipGenerator = fc.tuple(
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 })
      ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

      // Generator for HTTP methods
      const methodGenerator = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS');

      // Generator for URL paths
      const pathGenerator = fc.string({ minLength: 1, maxLength: 100 })
        .filter(s => s.length > 0 && !s.includes(' ') && !s.includes('"'))
        .map(s => s.startsWith('/') ? s : '/' + s);

      // Generator for HTTP status codes
      const statusGenerator = fc.integer({ min: 100, max: 599 });

      // Generator for response sizes
      const bytesGenerator = fc.integer({ min: 0, max: 1000000 });

      // Generator for referrer URLs
      const referrerGenerator = fc.oneof(
        fc.constant('-'),
        fc.constant(''),
        fc.string({ minLength: 10, maxLength: 200 })
          .filter(s => !s.includes(' ') && !s.includes('"'))
          .map(s => `https://example.com/${s}`)
      );

      // Generator for user agents
      const userAgentGenerator = fc.string({ minLength: 10, maxLength: 200 })
        .filter(s => !s.includes('"') && s.trim().length > 0)
        .map(s => `Mozilla/5.0 ${s.replace(/"/g, '')}`);

      // Generator for timestamps
      const timestampGenerator = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
        .map(date => {
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const day = String(date.getDate()).padStart(2, '0');
          const month = months[date.getMonth()];
          const year = date.getFullYear();
          const hour = String(date.getHours()).padStart(2, '0');
          const minute = String(date.getMinutes()).padStart(2, '0');
          const second = String(date.getSeconds()).padStart(2, '0');
          return `[${day}/${month}/${year}:${hour}:${minute}:${second} +0000]`;
        });

      // Generator for complete nginx log lines
      const nginxLogGenerator = fc.tuple(
        ipGenerator,
        timestampGenerator,
        methodGenerator,
        pathGenerator,
        statusGenerator,
        bytesGenerator,
        referrerGenerator,
        userAgentGenerator
      ).map(([ip, timestamp, method, path, status, bytes, referrer, userAgent]) => {
        const request = `${method} ${path} HTTP/1.1`;
        return `${ip} - - ${timestamp} "${request}" ${status} ${bytes} "${referrer}" "${userAgent}"`;
      });

      const parser = new NginxLogParser('test.log', 0, 'combined');

      fc.assert(
        fc.property(nginxLogGenerator, (logLine) => {
          const entry = parser.parseLine(logLine);
          
          // Property: Parser should successfully extract entry from valid log line
          expect(entry).not.toBeNull();
          expect(entry).toBeInstanceOf(LogEntry);
          
          // Property: All required fields should be present and valid
          expect(entry.timestamp).toBeInstanceOf(Date);
          expect(entry.ip).toBeDefined();
          expect(typeof entry.ip).toBe('string');
          expect(entry.ip.length).toBeGreaterThan(0);
          
          expect(entry.method).toBeDefined();
          expect(typeof entry.method).toBe('string');
          expect(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']).toContain(entry.method);
          
          expect(entry.path).toBeDefined();
          expect(typeof entry.path).toBe('string');
          expect(entry.path).toMatch(/^\/.*$/); // Should start with /
          
          expect(entry.status).toBeDefined();
          expect(typeof entry.status).toBe('number');
          expect(entry.status).toBeGreaterThanOrEqual(100);
          expect(entry.status).toBeLessThan(600);
          
          expect(entry.bytes).toBeDefined();
          expect(typeof entry.bytes).toBe('number');
          expect(entry.bytes).toBeGreaterThanOrEqual(0);
          
          expect(entry.referrer).toBeDefined();
          expect(typeof entry.referrer).toBe('string');
          
          expect(entry.userAgent).toBeDefined();
          expect(typeof entry.userAgent).toBe('string');
          
          expect(entry.responseTime).toBeDefined();
          expect(typeof entry.responseTime).toBe('number');
          expect(entry.responseTime).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Parser should handle edge cases gracefully without crashing
     */
    it('should handle malformed log lines gracefully', () => {
      // Generator for potentially malformed log lines
      const malformedLogGenerator = fc.oneof(
        fc.constant(''),
        fc.constant('   '),
        fc.constant('\n'),
        fc.string({ maxLength: 1000 }),
        fc.string({ minLength: 1, maxLength: 50 }).map(s => s.repeat(10))
      );

      const parser = new NginxLogParser('test.log', 0, 'combined');

      fc.assert(
        fc.property(malformedLogGenerator, (logLine) => {
          // Property: Parser should not crash on malformed input
          expect(() => {
            const entry = parser.parseLine(logLine);
            // Entry can be null for invalid lines, but should not throw
            if (entry !== null) {
              expect(entry).toBeInstanceOf(LogEntry);
            }
          }).not.toThrow();
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Parser should consistently parse the same log line
     */
    it('should parse the same log line consistently', () => {
      const validLogLine = '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /test HTTP/1.1" 200 1234 "https://google.com" "Mozilla/5.0"';
      
      fc.assert(
        fc.property(fc.constant(validLogLine), (logLine) => {
          const parser1 = new NginxLogParser('test1.log', 0, 'combined');
          const parser2 = new NginxLogParser('test2.log', 0, 'combined');
          
          const entry1 = parser1.parseLine(logLine);
          const entry2 = parser2.parseLine(logLine);
          
          // Property: Same input should produce equivalent output
          expect(entry1).not.toBeNull();
          expect(entry2).not.toBeNull();
          
          expect(entry1.ip).toBe(entry2.ip);
          expect(entry1.method).toBe(entry2.method);
          expect(entry1.path).toBe(entry2.path);
          expect(entry1.status).toBe(entry2.status);
          expect(entry1.bytes).toBe(entry2.bytes);
          expect(entry1.referrer).toBe(entry2.referrer);
          expect(entry1.userAgent).toBe(entry2.userAgent);
          expect(entry1.timestamp.getTime()).toBe(entry2.timestamp.getTime());
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Parser should preserve data integrity during parsing
     */
    it('should preserve data integrity during parsing', () => {
      // Generator for log lines with known values
      const knownValueGenerator = fc.record({
        ip: fc.constantFrom('192.168.1.1', '10.0.0.1', '172.16.0.1'),
        method: fc.constantFrom('GET', 'POST'),
        path: fc.constantFrom('/home', '/about', '/contact'),
        status: fc.constantFrom(200, 404, 500),
        bytes: fc.constantFrom(1234, 5678, 0),
        referrer: fc.constantFrom('-', 'https://google.com', 'https://example.com'),
        userAgent: fc.constantFrom('Mozilla/5.0', 'Chrome/91.0')
      }).map(values => {
        const timestamp = '[04/Jan/2026:12:00:00 +0000]';
        const request = `${values.method} ${values.path} HTTP/1.1`;
        return {
          logLine: `${values.ip} - - ${timestamp} "${request}" ${values.status} ${values.bytes} "${values.referrer}" "${values.userAgent}"`,
          expected: values
        };
      });

      const parser = new NginxLogParser('test.log', 0, 'combined');

      fc.assert(
        fc.property(knownValueGenerator, ({ logLine, expected }) => {
          const entry = parser.parseLine(logLine);
          
          // Property: Parsed values should match input values exactly
          expect(entry).not.toBeNull();
          expect(entry.ip).toBe(expected.ip);
          expect(entry.method).toBe(expected.method);
          expect(entry.path).toBe(expected.path);
          expect(entry.status).toBe(expected.status);
          expect(entry.bytes).toBe(expected.bytes);
          expect(entry.referrer).toBe(expected.referrer);
          expect(entry.userAgent).toBe(expected.userAgent);
        }),
        { numRuns: 100 }
      );
    });
  });
});