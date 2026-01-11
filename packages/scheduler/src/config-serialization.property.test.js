/**
 * @fileoverview Property-based tests for configuration serialization round-trip
 * Feature: metrona-analytics-system, Property 11: Configuration Serialization Round-Trip
 * Validates: Requirements 3.3
 */

const fc = require('fast-check');
const yaml = require('js-yaml');
const { ConfigurationManager } = require('./config-manager');

describe('Property 11: Configuration Serialization Round-Trip', () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigurationManager({
      configPath: '/test/config.yaml',
      createBackups: false
    });
  });

  /**
   * Generator for valid site configurations
   */
  const validSiteConfigArbitrary = fc.record({
    siteId: fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), 
      { minLength: 1, maxLength: 30 }
    ),
    siteName: fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_'.split('')), 
      { minLength: 1, maxLength: 50 }
    ),
    domain: fc.constantFrom(
      'example.com', 'test-site.org', 'subdomain.example.co.uk', 
      'analytics.test', 'site123.net', 'my-domain.info'
    ),
    logPath: fc.constantFrom(
      '/var/log/nginx/access.log', '/home/user/logs/site.log', 
      '/tmp/test.log', '/var/log/analytics/site.log'
    ),
    schedule: fc.constantFrom(
      'daily', 'hourly', 'weekly', 'monthly',
      '0 0 * * *', '*/15 * * * *', '0 */6 * * *'
    ),
    enabled: fc.boolean(),
    timezone: fc.constantFrom('UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'),
    parserOptions: fc.option(fc.record({
      topContentLimit: fc.integer({ min: 1, max: 100 }),
      referrerLimit: fc.integer({ min: 1, max: 50 }),
      contentRanking: fc.option(fc.record({
        excludePatterns: fc.array(
          fc.constantFrom('*.css', '*.js', '*.png', '/admin/*', '/api/health'),
          { minLength: 0, maxLength: 5 }
        )
      }))
    }))
  });

  /**
   * Generator for valid configuration objects
   */
  const validConfigArbitrary = fc.record({
    version: fc.constantFrom('1.0', '1.1', '2.0'),
    scheduler: fc.option(fc.record({
      timezone: fc.constantFrom('UTC', 'America/New_York', 'Europe/London'),
      outputDir: fc.constantFrom('/var/analytics/data', '/home/user/analytics', '/tmp/analytics')
    })),
    sites: fc.array(validSiteConfigArbitrary, { minLength: 0, maxLength: 5 })
      .map(sites => {
        // Ensure unique siteIds and domains
        const uniqueSites = [];
        const usedSiteIds = new Set();
        const usedDomains = new Set();
        
        for (const site of sites) {
          if (!usedSiteIds.has(site.siteId) && !usedDomains.has(site.domain)) {
            usedSiteIds.add(site.siteId);
            usedDomains.add(site.domain);
            uniqueSites.push(site);
          }
        }
        
        return uniqueSites;
      }),
    jobs: fc.option(fc.record({
      cleanup: fc.option(fc.record({
        schedule: fc.constantFrom('daily', 'weekly', '0 2 * * *'),
        enabled: fc.boolean(),
        options: fc.option(fc.record({
          maxAge: fc.integer({ min: 1, max: 30 })
        }))
      })),
      healthCheck: fc.option(fc.record({
        schedule: fc.constantFrom('hourly', '*/30 * * * *', '0 */2 * * *'),
        enabled: fc.boolean()
      }))
    }))
  });

  describe('YAML Serialization Round-Trip Properties', () => {
    /**
     * Property: Valid configuration objects should survive YAML round-trip
     * For any valid configuration, serializing to YAML and deserializing back should produce equivalent object
     */
    it('should preserve configuration data through YAML round-trip', () => {
      fc.assert(fc.property(
        validConfigArbitrary,
        (originalConfig) => {
          // Serialize to YAML
          const yamlString = yaml.dump(originalConfig, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: true
          });
          
          // Deserialize back from YAML
          const deserializedConfig = yaml.load(yamlString);
          
          // Validate that deserialized config is valid
          expect(() => {
            configManager.validateConfiguration(deserializedConfig);
          }).not.toThrow();
          
          // Check structural equivalence
          expect(deserializedConfig).toEqual(originalConfig);
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Configuration Manager save/load should be consistent
     * For any valid configuration, saving and loading should produce the same result
     */
    it('should maintain consistency through ConfigurationManager save/load cycle', () => {
      fc.assert(fc.property(
        validConfigArbitrary,
        (originalConfig) => {
          // Validate original config
          expect(() => {
            configManager.validateConfiguration(originalConfig);
          }).not.toThrow();
          
          // Serialize using ConfigurationManager's method
          const yamlContent = yaml.dump(originalConfig, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: true
          });
          
          // Deserialize using ConfigurationManager's method
          const deserializedConfig = yaml.load(yamlContent);
          
          // Validate deserialized config
          expect(() => {
            configManager.validateConfiguration(deserializedConfig);
          }).not.toThrow();
          
          // Verify equivalence
          expect(deserializedConfig).toEqual(originalConfig);
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: YAML formatting should be consistent and deterministic
     * For any configuration, multiple serializations should produce identical YAML
     */
    it('should produce deterministic YAML output', () => {
      fc.assert(fc.property(
        validConfigArbitrary,
        (config) => {
          const yamlString1 = yaml.dump(config, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: true
          });
          
          const yamlString2 = yaml.dump(config, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: true
          });
          
          // Multiple serializations should be identical
          expect(yamlString1).toBe(yamlString2);
        }
      ), { numRuns: 50 });
    });
  });

  describe('Site Configuration Round-Trip Properties', () => {
    /**
     * Property: Site configurations should preserve all fields through serialization
     * For any valid site config, all fields should be preserved after YAML round-trip
     */
    it('should preserve all site configuration fields', () => {
      fc.assert(fc.property(
        validSiteConfigArbitrary,
        (originalSite) => {
          const config = {
            version: '1.0',
            sites: [originalSite]
          };
          
          // Serialize and deserialize
          const yamlString = yaml.dump(config, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: true
          });
          
          const deserializedConfig = yaml.load(yamlString);
          const deserializedSite = deserializedConfig.sites[0];
          
          // Check all required fields are preserved
          expect(deserializedSite.siteId).toBe(originalSite.siteId);
          expect(deserializedSite.siteName).toBe(originalSite.siteName);
          expect(deserializedSite.domain).toBe(originalSite.domain);
          expect(deserializedSite.logPath).toBe(originalSite.logPath);
          expect(deserializedSite.schedule).toBe(originalSite.schedule);
          expect(deserializedSite.enabled).toBe(originalSite.enabled);
          expect(deserializedSite.timezone).toBe(originalSite.timezone);
          
          // Check optional fields if present
          if (originalSite.parserOptions) {
            expect(deserializedSite.parserOptions).toEqual(originalSite.parserOptions);
          }
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Parser options should survive serialization with correct types
     * For any parser options, numeric values should remain numeric after round-trip
     */
    it('should preserve parser option types through serialization', () => {
      fc.assert(fc.property(
        fc.record({
          topContentLimit: fc.integer({ min: 1, max: 100 }),
          referrerLimit: fc.integer({ min: 1, max: 50 }),
          contentRanking: fc.record({
            excludePatterns: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 })
          })
        }),
        (originalParserOptions) => {
          const config = {
            version: '1.0',
            sites: [{
              siteId: 'test-site',
              siteName: 'Test Site',
              domain: 'example.com',
              logPath: '/var/log/test.log',
              schedule: 'daily',
              enabled: true,
              parserOptions: originalParserOptions
            }]
          };
          
          // Serialize and deserialize
          const yamlString = yaml.dump(config);
          const deserializedConfig = yaml.load(yamlString);
          const deserializedOptions = deserializedConfig.sites[0].parserOptions;
          
          // Check types are preserved
          expect(typeof deserializedOptions.topContentLimit).toBe('number');
          expect(typeof deserializedOptions.referrerLimit).toBe('number');
          expect(Array.isArray(deserializedOptions.contentRanking.excludePatterns)).toBe(true);
          
          // Check values are preserved
          expect(deserializedOptions.topContentLimit).toBe(originalParserOptions.topContentLimit);
          expect(deserializedOptions.referrerLimit).toBe(originalParserOptions.referrerLimit);
          expect(deserializedOptions.contentRanking.excludePatterns).toEqual(originalParserOptions.contentRanking.excludePatterns);
        }
      ), { numRuns: 50 });
    });
  });

  describe('Configuration Structure Preservation Properties', () => {
    /**
     * Property: Configuration structure should be preserved exactly
     * For any configuration, the object structure should remain identical after round-trip
     */
    it('should preserve configuration object structure', () => {
      fc.assert(fc.property(
        validConfigArbitrary,
        (originalConfig) => {
          // Serialize and deserialize
          const yamlString = yaml.dump(originalConfig, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: true
          });
          
          const deserializedConfig = yaml.load(yamlString);
          
          // Check top-level structure
          expect(Object.keys(deserializedConfig).sort()).toEqual(Object.keys(originalConfig).sort());
          
          // Check sites array structure
          if (originalConfig.sites) {
            expect(Array.isArray(deserializedConfig.sites)).toBe(true);
            expect(deserializedConfig.sites.length).toBe(originalConfig.sites.length);
          }
          
          // Check scheduler structure if present
          if (originalConfig.scheduler) {
            expect(typeof deserializedConfig.scheduler).toBe('object');
            expect(Object.keys(deserializedConfig.scheduler).sort()).toEqual(Object.keys(originalConfig.scheduler).sort());
          }
          
          // Check jobs structure if present
          if (originalConfig.jobs) {
            expect(typeof deserializedConfig.jobs).toBe('object');
            expect(Object.keys(deserializedConfig.jobs).sort()).toEqual(Object.keys(originalConfig.jobs).sort());
          }
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Boolean and numeric values should maintain their types
     * For any configuration with boolean/numeric values, types should be preserved
     */
    it('should preserve data types through serialization', () => {
      fc.assert(fc.property(
        validConfigArbitrary,
        (originalConfig) => {
          // Serialize and deserialize
          const yamlString = yaml.dump(originalConfig);
          const deserializedConfig = yaml.load(yamlString);
          
          // Check version type (string)
          if (originalConfig.version) {
            expect(typeof deserializedConfig.version).toBe('string');
          }
          
          // Check site boolean values
          if (originalConfig.sites) {
            originalConfig.sites.forEach((originalSite, index) => {
              const deserializedSite = deserializedConfig.sites[index];
              
              if (typeof originalSite.enabled === 'boolean') {
                expect(typeof deserializedSite.enabled).toBe('boolean');
                expect(deserializedSite.enabled).toBe(originalSite.enabled);
              }
            });
          }
          
          // Check jobs boolean values
          if (originalConfig.jobs) {
            if (originalConfig.jobs.cleanup && typeof originalConfig.jobs.cleanup.enabled === 'boolean') {
              expect(typeof deserializedConfig.jobs.cleanup.enabled).toBe('boolean');
            }
            if (originalConfig.jobs.healthCheck && typeof originalConfig.jobs.healthCheck.enabled === 'boolean') {
              expect(typeof deserializedConfig.jobs.healthCheck.enabled).toBe('boolean');
            }
          }
        }
      ), { numRuns: 100 });
    });
  });

  describe('Edge Case Serialization Properties', () => {
    /**
     * Property: Empty configurations should serialize correctly
     * For minimal valid configurations, serialization should work correctly
     */
    it('should handle minimal configurations correctly', () => {
      const minimalConfigs = [
        { version: '1.0', sites: [] },
        { version: '1.0', sites: [], scheduler: { timezone: 'UTC' } },
        { version: '1.0', sites: [], jobs: { cleanup: { enabled: false } } }
      ];

      minimalConfigs.forEach(config => {
        // Validate original
        expect(() => {
          configManager.validateConfiguration(config);
        }).not.toThrow();
        
        // Serialize and deserialize
        const yamlString = yaml.dump(config);
        const deserializedConfig = yaml.load(yamlString);
        
        // Validate deserialized
        expect(() => {
          configManager.validateConfiguration(deserializedConfig);
        }).not.toThrow();
        
        // Check equivalence
        expect(deserializedConfig).toEqual(config);
      });
    });

    /**
     * Property: Configurations with optional fields should handle undefined values correctly
     * For configurations with some undefined optional fields, serialization should work
     */
    it('should handle undefined optional fields correctly', () => {
      fc.assert(fc.property(
        fc.record({
          siteId: fc.string({ minLength: 1, maxLength: 20 }),
          siteName: fc.string({ minLength: 1, maxLength: 30 }),
          domain: fc.constantFrom('example.com', 'test.org'),
          logPath: fc.constantFrom('/var/log/test.log'),
          schedule: fc.constantFrom('daily', 'hourly'),
          enabled: fc.option(fc.boolean()),  // May be undefined
          timezone: fc.option(fc.constantFrom('UTC', 'America/New_York')),  // May be undefined
          parserOptions: fc.option(fc.record({
            topContentLimit: fc.integer({ min: 1, max: 50 })
          }))  // May be undefined
        }),
        (siteConfig) => {
          const config = {
            version: '1.0',
            sites: [siteConfig]
          };
          
          // Remove undefined fields (YAML doesn't serialize them)
          const cleanedSite = Object.fromEntries(
            Object.entries(siteConfig).filter(([_, value]) => value !== undefined)
          );
          const expectedConfig = {
            version: '1.0',
            sites: [cleanedSite]
          };
          
          // Serialize and deserialize
          const yamlString = yaml.dump(config);
          const deserializedConfig = yaml.load(yamlString);
          
          // Should match cleaned version (undefined fields removed)
          expect(deserializedConfig).toEqual(expectedConfig);
        }
      ), { numRuns: 50 });
    });
  });
});