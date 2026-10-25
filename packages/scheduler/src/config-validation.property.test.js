/**
 * @fileoverview Property-based tests for configuration input validation
 * Feature: metrona-analytics-system, Property 9: Comprehensive Input Validation
 * Validates: Requirements 3.1, 3.2, 3.5, 8.4
 */

const fc = require('fast-check');
const { ConfigurationManager } = require('./config-manager');

describe('Property 9: Comprehensive Input Validation', () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigurationManager({
      configPath: '/test/config.yaml',
      createBackups: false
    });
  });

  describe('Domain Name Validation Properties', () => {
    /**
     * Property: Valid domain names should always be accepted
     * For any valid domain name format, validation should return true
     */
    it('should accept all valid domain name formats', () => {
      fc.assert(fc.property(
        fc.record({
          labels: fc.array(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), { minLength: 1, maxLength: 63 })
              .filter(s => !s.startsWith('-') && !s.endsWith('-')),
            { minLength: 1, maxLength: 5 }
          )
        }),
        ({ labels }) => {
          const domain = labels.join('.');
          
          // Skip domains that are too long
          if (domain.length > 253) return true;
          
          const result = configManager.validateDomainName(domain);
          
          // All properly formatted domains should be valid
          expect(result).toBe(true);
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Invalid domain formats should always be rejected
     * For any domain with invalid characters or structure, validation should return false
     */
    it('should reject domains with invalid formats', () => {
      fc.assert(fc.property(
        fc.oneof(
          fc.constant(''),                    // Empty string
          fc.constant('.example.com'),        // Starting with dot
          fc.constant('example.com.'),        // Ending with dot
          fc.constant('ex..ample.com'),       // Double dots
          fc.constant('ex ample.com'),        // Spaces
          fc.constant('example-.com'),        // Label ending with hyphen
          fc.constant('-example.com'),        // Label starting with hyphen
          fc.stringOf(fc.char(), { minLength: 254, maxLength: 300 }) // Too long
        ),
        (invalidDomain) => {
          const result = configManager.validateDomainName(invalidDomain);
          expect(result).toBe(false);
        }
      ), { numRuns: 50 });
    });
  });

  describe('Log Path Validation Properties', () => {
    /**
     * Property: Valid absolute log paths should be accepted
     * For any properly formatted absolute path, validation should return true
     */
    it('should accept valid absolute log paths', () => {
      fc.assert(fc.property(
        fc.record({
          segments: fc.array(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')), { minLength: 1, maxLength: 20 }),
            { minLength: 1, maxLength: 8 }
          ),
          filename: fc.oneof(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')), { minLength: 1, maxLength: 20 }),
            fc.constant('') // Directory path
          )
        }),
        ({ segments, filename }) => {
          const pathSegments = ['', ...segments]; // Start with empty for leading slash
          const logPath = filename 
            ? pathSegments.join('/') + '/' + filename + '.log'
            : pathSegments.join('/') + '/';
          
          const result = configManager.validateLogPath(logPath);
          expect(result).toBe(true);
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Invalid log paths should be rejected
     * For any path with security issues or invalid format, validation should return false
     */
    it('should reject invalid log paths', () => {
      fc.assert(fc.property(
        fc.oneof(
          fc.constant(''),                           // Empty string
          fc.constant('relative/path.log'),          // Relative path
          fc.constant('/var/log/../etc/passwd'),     // Directory traversal
          fc.constant('/var/log//double.log'),       // Double slashes
          fc.constant('/var/log/file.txt'),          // Wrong extension
          fc.stringOf(fc.char().filter(c => c !== '/'), { minLength: 1, maxLength: 20 }) // No leading slash
        ),
        (invalidPath) => {
          const result = configManager.validateLogPath(invalidPath);
          expect(result).toBe(false);
        }
      ), { numRuns: 50 });
    });
  });

  describe('Schedule Validation Properties', () => {
    /**
     * Property: Predefined schedule formats should always be valid
     * For any predefined schedule name, validation should return true
     */
    it('should accept all predefined schedule formats', () => {
      const predefinedSchedules = [
        'daily', 'hourly', 'weekly', 'monthly',
        'every-minute', 'every-hour', 'every-day', 'every-week', 'every-month'
      ];

      fc.assert(fc.property(
        fc.constantFrom(...predefinedSchedules),
        (schedule) => {
          const result = configManager.validateSchedule(schedule);
          expect(result).toBe(true);
        }
      ), { numRuns: 50 });
    });

    /**
     * Property: Valid cron expressions should be accepted
     * For any properly formatted cron expression, validation should return true
     */
    it('should accept valid cron expressions', () => {
      fc.assert(fc.property(
        fc.record({
          minute: fc.oneof(fc.integer({ min: 0, max: 59 }), fc.constant('*')),
          hour: fc.oneof(fc.integer({ min: 0, max: 23 }), fc.constant('*')),
          day: fc.oneof(fc.integer({ min: 1, max: 31 }), fc.constant('*')),
          month: fc.oneof(fc.integer({ min: 1, max: 12 }), fc.constant('*')),
          weekday: fc.oneof(fc.integer({ min: 0, max: 7 }), fc.constant('*'))
        }),
        ({ minute, hour, day, month, weekday }) => {
          const cronExpression = `${minute} ${hour} ${day} ${month} ${weekday}`;
          
          const result = configManager.validateSchedule(cronExpression);
          expect(result).toBe(true);
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Invalid schedule formats should be rejected
     * For any malformed schedule string, validation should return false
     */
    it('should reject invalid schedule formats', () => {
      fc.assert(fc.property(
        fc.oneof(
          fc.constant(''),                    // Empty string
          fc.constant('invalid-schedule'),    // Unknown format
          fc.constant('* * * *'),            // Too few cron fields
          fc.constant('60 25 32 13 8'),      // Out of range cron values
          fc.stringOf(fc.char().filter(c => !/[0-9*\s-]/.test(c)), { minLength: 1, maxLength: 20 }) // Invalid characters
        ),
        (invalidSchedule) => {
          const result = configManager.validateSchedule(invalidSchedule);
          expect(result).toBe(false);
        }
      ), { numRuns: 50 });
    });
  });

  describe('Configuration Value Validation Properties', () => {
    /**
     * Property: Valid configuration values should be accepted
     * For any properly typed configuration value, validation should succeed
     */
    it('should accept valid configuration values', () => {
      fc.assert(fc.property(
        fc.record({
          topContentLimit: fc.integer({ min: 1, max: 1000 }),
          referrerLimit: fc.integer({ min: 1, max: 1000 }),
          excludePatterns: fc.array(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789/.*-_'.split('')), { minLength: 1, maxLength: 50 }),
            { minLength: 0, maxLength: 10 }
          )
        }),
        ({ topContentLimit, referrerLimit, excludePatterns }) => {
          const parserOptions = {
            topContentLimit,
            referrerLimit,
            contentRanking: {
              excludePatterns
            }
          };
          
          expect(() => {
            configManager.validateParserOptions(parserOptions);
          }).not.toThrow();
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Invalid configuration values should be rejected with specific errors
     * For any improperly typed or out-of-range value, validation should throw descriptive errors
     */
    it('should reject invalid configuration values with specific errors', () => {
      fc.assert(fc.property(
        fc.oneof(
          // Invalid topContentLimit
          fc.record({
            topContentLimit: fc.oneof(
              fc.constant(0),           // Zero
              fc.constant(-1),          // Negative
              fc.constant(1.5),         // Float
              fc.constant('invalid')    // String
            )
          }),
          // Invalid referrerLimit  
          fc.record({
            referrerLimit: fc.oneof(
              fc.constant(0),           // Zero
              fc.constant(-1),          // Negative
              fc.constant(1.5),         // Float
              fc.constant('invalid')    // String
            )
          }),
          // Invalid excludePatterns
          fc.record({
            contentRanking: fc.record({
              excludePatterns: fc.oneof(
                fc.constant('not-array'),     // Not an array
                fc.array(fc.integer(), { minLength: 1 }), // Array of non-strings (an empty array is valid)
                fc.constant(null)             // Null
              )
            })
          })
        ),
        (invalidConfig) => {
          expect(() => {
            configManager.validateParserOptions(invalidConfig);
          }).toThrow();
        }
      ), { numRuns: 50 });
    });
  });

  describe('Site Configuration Validation Properties', () => {
    /**
     * Property: Complete valid site configurations should be accepted
     * For any site config with all required valid fields, validation should succeed
     */
    it('should accept complete valid site configurations', () => {
      fc.assert(fc.property(
        fc.record({
          siteId: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 1, maxLength: 50 }),
          siteName: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_'.split('')), { minLength: 1, maxLength: 100 }),
          domain: fc.constantFrom('example.com', 'test-site.org', 'subdomain.example.co.uk'),
          logPath: fc.constantFrom('/var/log/nginx/access.log', '/home/user/logs/site.log', '/tmp/test.log'),
          schedule: fc.constantFrom('daily', 'hourly', '0 0 * * *', '*/15 * * * *'),
          enabled: fc.boolean(),
          timezone: fc.constantFrom('UTC', 'America/New_York', 'Europe/London')
        }),
        (siteConfig) => {
          expect(() => {
            configManager.validateSiteConfiguration(siteConfig);
          }).not.toThrow();
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Site configurations missing required fields should be rejected
     * For any site config missing required fields, validation should throw specific errors
     */
    it('should reject site configurations missing required fields', () => {
      const requiredFields = ['siteId', 'siteName', 'domain', 'logPath', 'schedule'];
      
      fc.assert(fc.property(
        fc.constantFrom(...requiredFields),
        (fieldToOmit) => {
          const validSiteConfig = {
            siteId: 'test-site',
            siteName: 'Test Site',
            domain: 'example.com',
            logPath: '/var/log/nginx/access.log',
            schedule: 'daily',
            enabled: true
          };
          
          // Remove the required field
          delete validSiteConfig[fieldToOmit];
          
          expect(() => {
            configManager.validateSiteConfiguration(validSiteConfig);
          }).toThrow();
        }
      ), { numRuns: 25 });
    });
  });

  describe('Error Message Specificity Properties', () => {
    /**
     * Property: Validation errors should contain specific field information
     * For any validation error, the error message should identify the problematic field
     */
    it('should provide specific error messages for field validation failures', () => {
      const testCases = [
        {
          config: { siteId: '', siteName: 'Test', domain: 'example.com', logPath: '/var/log/test.log', schedule: 'daily' },
          expectedError: 'siteId'
        },
        {
          config: { siteId: 'test', siteName: '', domain: 'example.com', logPath: '/var/log/test.log', schedule: 'daily' },
          expectedError: 'siteName'
        },
        {
          config: { siteId: 'test', siteName: 'Test', domain: '.invalid', logPath: '/var/log/test.log', schedule: 'daily' },
          expectedError: 'domain'
        },
        {
          config: { siteId: 'test', siteName: 'Test', domain: 'example.com', logPath: 'relative/path', schedule: 'daily' },
          expectedError: 'path'
        },
        {
          config: { siteId: 'test', siteName: 'Test', domain: 'example.com', logPath: '/var/log/test.log', schedule: 'invalid' },
          expectedError: 'schedule'
        }
      ];

      testCases.forEach(({ config, expectedError }) => {
        try {
          configManager.validateSiteConfiguration(config);
          fail('Expected validation to throw an error');
        } catch (error) {
          expect(error.message.toLowerCase()).toContain(expectedError.toLowerCase());
        }
      });
    });

    /**
     * Property: Configuration validation should provide context for nested errors
     * For any nested configuration error, the error message should include context path
     */
    it('should provide contextual error messages for nested validation failures', () => {
      const invalidConfigs = [
        {
          config: {
            sites: [
              { siteId: 'valid', siteName: 'Valid', domain: 'example.com', logPath: '/var/log/test.log', schedule: 'daily' },
              { siteId: 'invalid', siteName: '', domain: 'example.com', logPath: '/var/log/test.log', schedule: 'daily' }
            ]
          },
          expectedContext: 'Site 2'
        },
        {
          config: {
            sites: [
              { siteId: 'duplicate', siteName: 'Site 1', domain: 'example.com', logPath: '/var/log/test.log', schedule: 'daily' },
              { siteId: 'duplicate', siteName: 'Site 2', domain: 'other.com', logPath: '/var/log/other.log', schedule: 'daily' }
            ]
          },
          expectedContext: 'duplicate'
        }
      ];

      invalidConfigs.forEach(({ config, expectedContext }) => {
        try {
          configManager.validateConfiguration(config);
          fail('Expected validation to throw an error');
        } catch (error) {
          expect(error.message).toContain(expectedContext);
        }
      });
    });
  });

  describe('Input Sanitization Properties', () => {
    /**
     * Property: Domain names should be sanitized consistently
     * For any domain input, sanitization should produce consistent results
     */
    it('should sanitize domain names consistently', () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (input) => {
          const result1 = configManager.validateDomainName(input);
          const result2 = configManager.validateDomainName(input);
          
          // Validation should be deterministic
          expect(result1).toBe(result2);
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Path validation should prevent directory traversal
     * For any path containing traversal patterns, validation should reject it
     */
    it('should prevent directory traversal in log paths', () => {
      const traversalPatterns = ['..', '../', '/../', '\\..', '..\\'];
      
      fc.assert(fc.property(
        fc.record({
          basePath: fc.constantFrom('/var/log', '/home/user', '/tmp'),
          traversal: fc.constantFrom(...traversalPatterns),
          suffix: fc.constantFrom('passwd', 'shadow', 'config', 'secret.txt')
        }),
        ({ basePath, traversal, suffix }) => {
          const maliciousPath = `${basePath}/${traversal}/${suffix}`;
          
          const result = configManager.validateLogPath(maliciousPath);
          expect(result).toBe(false);
        }
      ), { numRuns: 50 });
    });
  });
});