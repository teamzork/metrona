/**
 * @fileoverview Property-based tests for site processing conditional logic
 * Feature: metrona-analytics-system, Property 13: Site Processing Conditional Logic
 * Validates: Requirements 3.6
 */

const fc = require('fast-check');
const { ConfigurationManager } = require('./config-manager');

describe('Property 13: Site Processing Conditional Logic', () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigurationManager({
      configPath: '/test/config.yaml',
      createBackups: false
    });
  });

  /**
   * Generator for valid site configurations with varying enabled states
   */
  const siteConfigArbitrary = fc.record({
    siteId: fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), 
      { minLength: 1, maxLength: 20 }
    ),
    siteName: fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_'.split('')), 
      { minLength: 1, maxLength: 30 }
    ),
    domain: fc.constantFrom(
      'example.com', 'test-site.org', 'analytics.test', 
      'site1.net', 'site2.info', 'site3.co.uk'
    ),
    logPath: fc.constantFrom(
      '/var/log/nginx/access.log', '/home/user/logs/site.log', 
      '/tmp/test.log', '/var/log/analytics/site.log'
    ),
    schedule: fc.constantFrom('daily', 'hourly', '0 0 * * *'),
    enabled: fc.boolean(),
    timezone: fc.constantFrom('UTC', 'America/New_York', 'Europe/London')
  });

  /**
   * Mock scheduler class to test site processing logic
   */
  class MockScheduler {
    constructor() {
      this.scheduledJobs = new Map();
      this.processedSites = new Set();
    }

    scheduleJob(jobId, cronExpression, jobFunction, options) {
      this.scheduledJobs.set(jobId, {
        jobId,
        cronExpression,
        jobFunction,
        options,
        enabled: true
      });
      return true;
    }

    removeJob(jobId) {
      return this.scheduledJobs.delete(jobId);
    }

    getAllJobs() {
      return Array.from(this.scheduledJobs.values());
    }

    // Simulate processing enabled sites
    processEnabledSites(sites) {
      this.processedSites.clear();
      
      for (const site of sites) {
        if (site.enabled !== false) {  // Default to enabled if not specified
          this.processedSites.add(site.siteId);
        }
      }
      
      return Array.from(this.processedSites);
    }

    // Simulate job scheduling based on site enabled status
    scheduleJobsFromSites(sites) {
      const scheduledJobIds = [];
      
      for (const site of sites) {
        if (site.enabled !== false) {  // Default to enabled if not specified
          const jobId = `site-${site.siteId}`;
          this.scheduleJob(jobId, site.schedule, () => {}, {
            description: `Analytics processing for ${site.siteName}`,
            siteConfig: site
          });
          scheduledJobIds.push(jobId);
        }
      }
      
      return scheduledJobIds;
    }
  }

  describe('Site Enabled/Disabled Processing Properties', () => {
    /**
     * Property: Only enabled sites should be processed
     * For any collection of sites with mixed enabled/disabled flags, only enabled sites should be processed
     */
    it('should process only sites that are enabled', () => {
      fc.assert(fc.property(
        fc.array(siteConfigArbitrary, { minLength: 1, maxLength: 10 })
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
        (sites) => {
          const mockScheduler = new MockScheduler();
          
          // Process sites using the mock scheduler
          const processedSiteIds = mockScheduler.processEnabledSites(sites);
          
          // Count expected enabled sites
          const expectedEnabledSites = sites.filter(site => site.enabled !== false);
          const expectedSiteIds = expectedEnabledSites.map(site => site.siteId);
          
          // Verify only enabled sites were processed
          expect(processedSiteIds.sort()).toEqual(expectedSiteIds.sort());
          
          // Verify disabled sites were not processed
          const disabledSites = sites.filter(site => site.enabled === false);
          for (const disabledSite of disabledSites) {
            expect(processedSiteIds).not.toContain(disabledSite.siteId);
          }
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Sites with undefined enabled flag should default to enabled
     * For any site without an explicit enabled flag, it should be treated as enabled
     */
    it('should treat sites with undefined enabled flag as enabled', () => {
      fc.assert(fc.property(
        fc.array(
          siteConfigArbitrary.map(site => {
            // Remove enabled flag to make it undefined
            const { enabled, ...siteWithoutEnabled } = site;
            return siteWithoutEnabled;
          }),
          { minLength: 1, maxLength: 5 }
        ).map(sites => {
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
        (sitesWithoutEnabledFlag) => {
          const mockScheduler = new MockScheduler();
          
          // Process sites (all should be treated as enabled)
          const processedSiteIds = mockScheduler.processEnabledSites(sitesWithoutEnabledFlag);
          
          // All sites should be processed since enabled defaults to true
          const expectedSiteIds = sitesWithoutEnabledFlag.map(site => site.siteId);
          
          expect(processedSiteIds.sort()).toEqual(expectedSiteIds.sort());
        }
      ), { numRuns: 50 });
    });

    /**
     * Property: Explicitly disabled sites should never be processed
     * For any site with enabled: false, it should never be processed regardless of other properties
     */
    it('should never process explicitly disabled sites', () => {
      fc.assert(fc.property(
        fc.array(
          siteConfigArbitrary.map(site => ({ ...site, enabled: false })), // Force all sites to be disabled
          { minLength: 1, maxLength: 5 }
        ).map(sites => {
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
        (disabledSites) => {
          const mockScheduler = new MockScheduler();
          
          // Process sites (none should be processed)
          const processedSiteIds = mockScheduler.processEnabledSites(disabledSites);
          
          // No sites should be processed
          expect(processedSiteIds).toEqual([]);
        }
      ), { numRuns: 50 });
    });
  });

  describe('Job Scheduling Based on Site Status Properties', () => {
    /**
     * Property: Jobs should only be scheduled for enabled sites
     * For any collection of sites, jobs should only be created for sites that are enabled
     */
    it('should schedule jobs only for enabled sites', () => {
      fc.assert(fc.property(
        fc.array(siteConfigArbitrary, { minLength: 1, maxLength: 8 })
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
        (sites) => {
          const mockScheduler = new MockScheduler();
          
          // Schedule jobs based on site status
          const scheduledJobIds = mockScheduler.scheduleJobsFromSites(sites);
          
          // Count expected enabled sites
          const enabledSites = sites.filter(site => site.enabled !== false);
          const expectedJobIds = enabledSites.map(site => `site-${site.siteId}`);
          
          // Verify correct jobs were scheduled
          expect(scheduledJobIds.sort()).toEqual(expectedJobIds.sort());
          
          // Verify job details
          const allJobs = mockScheduler.getAllJobs();
          expect(allJobs.length).toBe(enabledSites.length);
          
          // Check each job corresponds to an enabled site
          for (const job of allJobs) {
            const siteId = job.jobId.replace('site-', '');
            const correspondingSite = sites.find(site => site.siteId === siteId);
            
            expect(correspondingSite).toBeDefined();
            expect(correspondingSite.enabled).not.toBe(false);
            expect(job.options.siteConfig).toEqual(correspondingSite);
          }
        }
      ), { numRuns: 100 });
    });

    /**
     * Property: Job count should equal enabled site count
     * For any configuration, the number of scheduled jobs should equal the number of enabled sites
     */
    it('should have job count equal to enabled site count', () => {
      fc.assert(fc.property(
        fc.array(siteConfigArbitrary, { minLength: 0, maxLength: 10 })
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
        (sites) => {
          const mockScheduler = new MockScheduler();
          
          // Schedule jobs
          mockScheduler.scheduleJobsFromSites(sites);
          
          // Count enabled sites
          const enabledSiteCount = sites.filter(site => site.enabled !== false).length;
          
          // Count scheduled jobs
          const scheduledJobCount = mockScheduler.getAllJobs().length;
          
          // Counts should match
          expect(scheduledJobCount).toBe(enabledSiteCount);
        }
      ), { numRuns: 100 });
    });
  });

  describe('Configuration Manager Integration Properties', () => {
    /**
     * Property: getEnabledSites should return only enabled sites
     * For any configuration, getEnabledSites should filter correctly based on enabled flag
     */
    it('should return only enabled sites from configuration', async () => {
      // Mock the file system operations
      const fs = require('fs').promises;
      jest.spyOn(fs, 'access').mockResolvedValue();
      jest.spyOn(fs, 'readFile').mockImplementation(async () => {
        // This will be set by the property test
        return configManager._mockConfigContent;
      });

      await fc.assert(fc.asyncProperty(
        fc.array(siteConfigArbitrary, { minLength: 1, maxLength: 6 })
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
        async (sites) => {
          const config = {
            version: '1.0',
            sites: sites
          };
          
          // Set up mock config content
          configManager._mockConfigContent = JSON.stringify(config);
          
          // Get enabled sites using ConfigurationManager
          const enabledSites = await configManager.getEnabledSites();
          
          // Calculate expected enabled sites
          const expectedEnabledSites = sites.filter(site => site.enabled !== false);
          
          // Verify correct filtering
          expect(enabledSites.length).toBe(expectedEnabledSites.length);
          
          const enabledSiteIds = enabledSites.map(site => site.siteId).sort();
          const expectedSiteIds = expectedEnabledSites.map(site => site.siteId).sort();
          
          expect(enabledSiteIds).toEqual(expectedSiteIds);
          
          // Verify no disabled sites are included
          const disabledSites = sites.filter(site => site.enabled === false);
          for (const disabledSite of disabledSites) {
            expect(enabledSiteIds).not.toContain(disabledSite.siteId);
          }
        }
      ), { numRuns: 50 });

      // Restore mocks
      jest.restoreAllMocks();
    });

    /**
     * Property: setSiteEnabled should correctly update site status
     * For any site, calling setSiteEnabled should update the enabled flag correctly
     */
    it('should correctly update site enabled status', async () => {
      // Mock the file system operations
      const fs = require('fs').promises;
      jest.spyOn(fs, 'access').mockResolvedValue();
      jest.spyOn(fs, 'mkdir').mockResolvedValue();
      jest.spyOn(fs, 'writeFile').mockResolvedValue();
      // Saving sets 0600 permissions and backups list the backup dir; keep
      // both off the real filesystem (/test/... doesn't exist)
      jest.spyOn(fs, 'chmod').mockResolvedValue();
      jest.spyOn(fs, 'readdir').mockResolvedValue([]);
      
      let mockConfig = null;
      jest.spyOn(fs, 'readFile').mockImplementation(async () => {
        return JSON.stringify(mockConfig);
      });

      await fc.assert(fc.asyncProperty(
        fc.record({
          site: siteConfigArbitrary,
          newEnabledStatus: fc.boolean()
        }),
        async ({ site, newEnabledStatus }) => {
          // Set up initial config
          mockConfig = {
            version: '1.0',
            sites: [site]
          };
          
          // Update site enabled status
          const updatedConfig = await configManager.setSiteEnabled(site.siteId, newEnabledStatus);
          
          // Verify the site's enabled status was updated
          const updatedSite = updatedConfig.sites.find(s => s.siteId === site.siteId);
          expect(updatedSite).toBeDefined();
          expect(updatedSite.enabled).toBe(newEnabledStatus);
          
          // Verify other properties remain unchanged
          expect(updatedSite.siteId).toBe(site.siteId);
          expect(updatedSite.siteName).toBe(site.siteName);
          expect(updatedSite.domain).toBe(site.domain);
          expect(updatedSite.logPath).toBe(site.logPath);
          expect(updatedSite.schedule).toBe(site.schedule);
        }
      ), { numRuns: 50 });

      // Restore mocks
      jest.restoreAllMocks();
    });
  });

  describe('Edge Case Processing Properties', () => {
    /**
     * Property: Empty site list should result in no processing
     * For an empty sites array, no sites should be processed
     */
    it('should handle empty site lists correctly', () => {
      const mockScheduler = new MockScheduler();
      
      // Process empty site list
      const processedSiteIds = mockScheduler.processEnabledSites([]);
      const scheduledJobIds = mockScheduler.scheduleJobsFromSites([]);
      
      // No sites should be processed or scheduled
      expect(processedSiteIds).toEqual([]);
      expect(scheduledJobIds).toEqual([]);
      expect(mockScheduler.getAllJobs()).toEqual([]);
    });

    /**
     * Property: Mixed enabled/disabled sites should be processed correctly
     * For any mix of enabled and disabled sites, processing should be consistent
     */
    it('should handle mixed enabled/disabled sites consistently', () => {
      fc.assert(fc.property(
        fc.record({
          enabledCount: fc.integer({ min: 1, max: 5 }),
          disabledCount: fc.integer({ min: 1, max: 5 })
        }),
        ({ enabledCount, disabledCount }) => {
          // Create enabled sites
          const enabledSites = Array.from({ length: enabledCount }, (_, i) => ({
            siteId: `enabled-site-${i}`,
            siteName: `Enabled Site ${i}`,
            domain: `enabled${i}.com`,
            logPath: `/var/log/enabled${i}.log`,
            schedule: 'daily',
            enabled: true,
            timezone: 'UTC'
          }));
          
          // Create disabled sites
          const disabledSites = Array.from({ length: disabledCount }, (_, i) => ({
            siteId: `disabled-site-${i}`,
            siteName: `Disabled Site ${i}`,
            domain: `disabled${i}.com`,
            logPath: `/var/log/disabled${i}.log`,
            schedule: 'daily',
            enabled: false,
            timezone: 'UTC'
          }));
          
          const allSites = [...enabledSites, ...disabledSites];
          const mockScheduler = new MockScheduler();
          
          // Process sites
          const processedSiteIds = mockScheduler.processEnabledSites(allSites);
          const scheduledJobIds = mockScheduler.scheduleJobsFromSites(allSites);
          
          // Verify only enabled sites were processed
          expect(processedSiteIds.length).toBe(enabledCount);
          expect(scheduledJobIds.length).toBe(enabledCount);
          
          // Verify all processed sites are from the enabled list
          const enabledSiteIds = enabledSites.map(site => site.siteId);
          for (const processedId of processedSiteIds) {
            expect(enabledSiteIds).toContain(processedId);
          }
          
          // Verify no disabled sites were processed
          const disabledSiteIds = disabledSites.map(site => site.siteId);
          for (const processedId of processedSiteIds) {
            expect(disabledSiteIds).not.toContain(processedId);
          }
        }
      ), { numRuns: 50 });
    });
  });
});