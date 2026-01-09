/**
 * @fileoverview Property-based tests for configuration hot-reload correctness
 * Feature: metrona-analytics-system
 * Property 8: Configuration Hot-Reload Correctness - validates Requirements 2.3
 */

const fc = require('fast-check');
const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { SchedulerDaemon } = require('./scheduler-daemon');

describe('Property 8: Configuration Hot-Reload Correctness', () => {
  let tempConfigDir;
  let configPath;
  let testCounter = 0;
  
  beforeEach(async () => {
    // Create unique temporary directory for each test
    tempConfigDir = path.join(__dirname, `test-config-prop-${Date.now()}-${testCounter++}`);
    await fs.mkdir(tempConfigDir, { recursive: true });
    configPath = path.join(tempConfigDir, 'scheduler.yaml');
  });
  
  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempConfigDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  /**
   * Property 8.1: Configuration Reload Consistency
   * Validates: Requirement 2.3 - Scheduler reloads settings without restart
   */
  test('Property 8.1: Configuration reload should be consistent across valid configurations', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        initialSites: fc.array(
          fc.record({
            siteId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            siteName: fc.string({ minLength: 1, maxLength: 50 }),
            domain: fc.constantFrom('example.com', 'test.org', 'demo.net', 'site.io'),
            schedule: fc.constantFrom('daily', 'hourly', '0 0 * * *', '0 */6 * * *'),
            enabled: fc.boolean()
          }),
          { minLength: 1, maxLength: 3 }
        ),
        updatedSites: fc.array(
          fc.record({
            siteId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            siteName: fc.string({ minLength: 1, maxLength: 50 }),
            domain: fc.constantFrom('updated.com', 'new.org', 'changed.net', 'fresh.io'),
            schedule: fc.constantFrom('daily', 'hourly', '0 12 * * *', '0 */4 * * *'),
            enabled: fc.boolean()
          }),
          { minLength: 1, maxLength: 4 }
        )
      }),
      async (testData) => {
        // Ensure unique site IDs
        const uniqueInitialSites = testData.initialSites.map((site, index) => ({
          ...site,
          siteId: `initial-${site.siteId}-${index}`,
          logPath: `/tmp/initial-${index}.log`
        }));
        
        const uniqueUpdatedSites = testData.updatedSites.map((site, index) => ({
          ...site,
          siteId: `updated-${site.siteId}-${index}`,
          logPath: `/tmp/updated-${index}.log`
        }));
        
        // Create initial configuration
        const initialConfig = {
          version: '1.0',
          scheduler: { timezone: 'UTC', outputDir: './test-analytics' },
          sites: uniqueInitialSites,
          jobs: {
            cleanup: { schedule: 'daily', enabled: true, options: { maxAge: 7 } },
            healthCheck: { schedule: 'hourly', enabled: true }
          }
        };
        
        await fs.writeFile(configPath, yaml.dump(initialConfig), 'utf8');
        
        // Create daemon and start
        const daemon = new SchedulerDaemon({
          configPath,
          watchConfig: false,
          schedulerOptions: { scheduled: false }
        });
        
        // Handle error events silently
        daemon.on('error', () => {});
        
        try {
          await daemon.start();
          
          // Verify initial state
          const initialStatus = daemon.getStatus();
          expect(initialStatus.configLoaded).toBe(true);
          expect(initialStatus.sites).toBe(uniqueInitialSites.length);
          
          const initialJobs = daemon.scheduler.getAllJobs();
          const initialEnabledSites = uniqueInitialSites.filter(s => s.enabled !== false).length;
          const expectedInitialJobs = initialEnabledSites + 2; // sites + 2 system jobs
          expect(initialJobs).toHaveLength(expectedInitialJobs);
          
          // Create updated configuration
          const updatedConfig = {
            version: '1.0',
            scheduler: { timezone: 'UTC', outputDir: './test-analytics' },
            sites: uniqueUpdatedSites,
            jobs: {
              cleanup: { schedule: 'daily', enabled: true, options: { maxAge: 7 } },
              healthCheck: { schedule: 'hourly', enabled: true }
            }
          };
          
          await fs.writeFile(configPath, yaml.dump(updatedConfig), 'utf8');
          
          // Perform hot-reload
          await daemon.manualConfigReload({ force: true });
          
          // Verify updated state
          const updatedStatus = daemon.getStatus();
          expect(updatedStatus.configLoaded).toBe(true);
          expect(updatedStatus.sites).toBe(uniqueUpdatedSites.length);
          
          const updatedJobs = daemon.scheduler.getAllJobs();
          const updatedEnabledSites = uniqueUpdatedSites.filter(s => s.enabled !== false).length;
          const expectedUpdatedJobs = updatedEnabledSites + 2; // sites + 2 system jobs
          expect(updatedJobs).toHaveLength(expectedUpdatedJobs);
          
          // Verify job IDs match expected pattern
          const jobIds = updatedJobs.map(job => job.jobId);
          for (const site of uniqueUpdatedSites) {
            if (site.enabled !== false) {
              expect(jobIds).toContain(`site-${site.siteId}`);
            }
          }
          expect(jobIds).toContain('system-cleanup');
          expect(jobIds).toContain('system-health-check');
          
          // Verify daemon is still running (no restart required)
          expect(updatedStatus.isRunning).toBe(true);
          expect(updatedStatus.isShuttingDown).toBe(false);
          
        } finally {
          await daemon.stop();
        }
      }
    ), { numRuns: 50 }); // Reduced runs due to async complexity
  });

  /**
   * Property 8.2: Configuration Validation Consistency
   * Validates: Requirement 2.3 - Invalid configurations are rejected consistently
   */
  test('Property 8.2: Configuration validation should be consistent across invalid inputs', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        validConfig: fc.record({
          siteId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
          siteName: fc.string({ minLength: 1, maxLength: 50 }),
          domain: fc.constantFrom('valid.com', 'good.org', 'ok.net'),
          schedule: fc.constantFrom('daily', 'hourly', '0 0 * * *')
        }),
        invalidationType: fc.constantFrom(
          'empty-siteId',
          'invalid-domain',
          'invalid-schedule',
          'missing-siteName',
          'missing-logPath'
        )
      }),
      async (testData) => {
        // Create initial valid configuration
        const initialConfig = {
          version: '1.0',
          sites: [{
            siteId: testData.validConfig.siteId,
            siteName: testData.validConfig.siteName,
            domain: testData.validConfig.domain,
            logPath: '/tmp/valid.log',
            schedule: testData.validConfig.schedule,
            enabled: true
          }]
        };
        
        await fs.writeFile(configPath, yaml.dump(initialConfig), 'utf8');
        
        const daemon = new SchedulerDaemon({
          configPath,
          watchConfig: false,
          schedulerOptions: { scheduled: false }
        });
        
        daemon.on('error', () => {});
        
        try {
          await daemon.start();
          
          // Verify initial valid state
          const initialStatus = daemon.getStatus();
          expect(initialStatus.configLoaded).toBe(true);
          expect(initialStatus.sites).toBe(1);
          
          // Create invalid configuration based on invalidation type
          let invalidConfig = {
            version: '1.0',
            sites: [{
              siteId: testData.validConfig.siteId,
              siteName: testData.validConfig.siteName,
              domain: testData.validConfig.domain,
              logPath: '/tmp/valid.log',
              schedule: testData.validConfig.schedule,
              enabled: true
            }]
          };
          
          // Apply invalidation
          switch (testData.invalidationType) {
            case 'empty-siteId':
              invalidConfig.sites[0].siteId = '';
              break;
            case 'invalid-domain':
              invalidConfig.sites[0].domain = 'invalid..domain';
              break;
            case 'invalid-schedule':
              invalidConfig.sites[0].schedule = 'invalid-schedule';
              break;
            case 'missing-siteName':
              delete invalidConfig.sites[0].siteName;
              break;
            case 'missing-logPath':
              delete invalidConfig.sites[0].logPath;
              break;
          }
          
          await fs.writeFile(configPath, yaml.dump(invalidConfig), 'utf8');
          
          // Attempt reload should fail
          await expect(daemon.manualConfigReload({ force: true })).rejects.toThrow();
          
          // Verify original configuration is maintained
          const finalStatus = daemon.getStatus();
          expect(finalStatus.configLoaded).toBe(true);
          expect(finalStatus.sites).toBe(1); // Original site count maintained
          expect(finalStatus.isRunning).toBe(true); // Still running
          
        } finally {
          await daemon.stop();
        }
      }
    ), { numRuns: 50 });
  });

  /**
   * Property 8.3: Job Scheduling Consistency During Reload
   * Validates: Requirement 2.3 - Jobs are rescheduled correctly during reload
   */
  test('Property 8.3: Job scheduling should be consistent during configuration reload', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        siteConfigs: fc.array(
          fc.record({
            siteId: fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            siteName: fc.string({ minLength: 1, maxLength: 30 }),
            domain: fc.constantFrom('site1.com', 'site2.org', 'site3.net', 'site4.io'),
            schedule: fc.constantFrom('daily', 'hourly', '0 6 * * *', '0 */8 * * *'),
            enabled: fc.boolean()
          }),
          { minLength: 1, maxLength: 3 }
        ),
        systemJobs: fc.record({
          cleanup: fc.boolean(),
          healthCheck: fc.boolean()
        })
      }),
      async (testData) => {
        // Ensure unique site IDs
        const uniqueSites = testData.siteConfigs.map((site, index) => ({
          ...site,
          siteId: `site-${site.siteId}-${index}`,
          logPath: `/tmp/site-${index}.log`
        }));
        
        const config = {
          version: '1.0',
          scheduler: { timezone: 'UTC', outputDir: './test-analytics' },
          sites: uniqueSites,
          jobs: {
            cleanup: {
              schedule: 'daily',
              enabled: testData.systemJobs.cleanup,
              options: { maxAge: 7 }
            },
            healthCheck: {
              schedule: 'hourly',
              enabled: testData.systemJobs.healthCheck
            }
          }
        };
        
        await fs.writeFile(configPath, yaml.dump(config), 'utf8');
        
        const daemon = new SchedulerDaemon({
          configPath,
          watchConfig: false,
          schedulerOptions: { scheduled: false }
        });
        
        daemon.on('error', () => {});
        
        try {
          await daemon.start();
          
          // Calculate expected job counts
          const enabledSites = uniqueSites.filter(s => s.enabled !== false).length;
          const enabledSystemJobs = (testData.systemJobs.cleanup ? 1 : 0) + 
                                   (testData.systemJobs.healthCheck ? 1 : 0);
          const expectedTotalJobs = enabledSites + enabledSystemJobs;
          
          // Verify initial job scheduling
          const initialJobs = daemon.scheduler.getAllJobs();
          expect(initialJobs).toHaveLength(expectedTotalJobs);
          
          // Verify all jobs are properly configured
          for (const job of initialJobs) {
            expect(job.jobId).toBeDefined();
            expect(job.cronExpression).toBeDefined();
            expect(job.enabled).toBe(true);
            expect(job.runCount).toBe(0);
            expect(job.isRunning).toBe(false);
          }
          
          // Verify site jobs have correct IDs
          const siteJobIds = initialJobs
            .filter(job => job.jobId.startsWith('site-'))
            .map(job => job.jobId);
          
          for (const site of uniqueSites) {
            if (site.enabled !== false) {
              expect(siteJobIds).toContain(`site-${site.siteId}`);
            }
          }
          
          // Verify system jobs
          const systemJobIds = initialJobs
            .filter(job => job.jobId.startsWith('system-'))
            .map(job => job.jobId);
          
          if (testData.systemJobs.cleanup) {
            expect(systemJobIds).toContain('system-cleanup');
          }
          if (testData.systemJobs.healthCheck) {
            expect(systemJobIds).toContain('system-health-check');
          }
          
          // Perform reload with same configuration (should be idempotent)
          await daemon.manualConfigReload({ force: true });
          
          // Verify job scheduling is still consistent
          const reloadedJobs = daemon.scheduler.getAllJobs();
          expect(reloadedJobs).toHaveLength(expectedTotalJobs);
          
          // Verify job properties are maintained
          for (const job of reloadedJobs) {
            expect(job.jobId).toBeDefined();
            expect(job.cronExpression).toBeDefined();
            expect(job.enabled).toBe(true);
            expect(job.runCount).toBe(0); // Should be reset after reload
            expect(job.isRunning).toBe(false);
          }
          
        } finally {
          await daemon.stop();
        }
      }
    ), { numRuns: 40 });
  });

  /**
   * Property 8.4: Configuration State Consistency
   * Validates: Requirement 2.3 - Configuration state remains consistent during reload
   */
  test('Property 8.4: Configuration state should remain consistent during reload operations', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        configSequence: fc.array(
          fc.record({
            version: fc.constantFrom('1.0', '1.1', '2.0'),
            timezone: fc.constantFrom('UTC', 'America/New_York', 'Europe/London'),
            outputDir: fc.constantFrom('./analytics', './data', './output'),
            siteCount: fc.integer({ min: 1, max: 3 }),
            cleanupEnabled: fc.boolean(),
            healthCheckEnabled: fc.boolean()
          }),
          { minLength: 2, maxLength: 4 }
        )
      }),
      async (testData) => {
        const daemon = new SchedulerDaemon({
          configPath,
          watchConfig: false,
          schedulerOptions: { scheduled: false }
        });
        
        daemon.on('error', () => {});
        
        try {
          // Apply configuration sequence
          for (let i = 0; i < testData.configSequence.length; i++) {
            const configData = testData.configSequence[i];
            
            // Generate sites for this configuration
            const sites = Array.from({ length: configData.siteCount }, (_, index) => ({
              siteId: `site-${i}-${index}`,
              siteName: `Site ${i}-${index}`,
              domain: `site${i}${index}.com`,
              logPath: `/tmp/site-${i}-${index}.log`,
              schedule: 'daily',
              enabled: true
            }));
            
            const config = {
              version: configData.version,
              scheduler: {
                timezone: configData.timezone,
                outputDir: configData.outputDir
              },
              sites,
              jobs: {
                cleanup: {
                  schedule: 'daily',
                  enabled: configData.cleanupEnabled,
                  options: { maxAge: 7 }
                },
                healthCheck: {
                  schedule: 'hourly',
                  enabled: configData.healthCheckEnabled
                }
              }
            };
            
            await fs.writeFile(configPath, yaml.dump(config), 'utf8');
            
            if (i === 0) {
              // Start daemon with first configuration
              await daemon.start();
            } else {
              // Reload with subsequent configurations
              await daemon.manualConfigReload({ force: true });
            }
            
            // Verify configuration state consistency
            const status = daemon.getStatus();
            expect(status.configLoaded).toBe(true);
            expect(status.sites).toBe(configData.siteCount);
            expect(status.isRunning).toBe(true);
            expect(status.isShuttingDown).toBe(false);
            
            // Verify configuration health
            expect(status.configHealth).toBeDefined();
            expect(status.configHealth.version).toBe(configData.version);
            expect(status.configHealth.totalSites).toBe(configData.siteCount);
            expect(status.configHealth.enabledSites).toBe(configData.siteCount);
            expect(status.configHealth.systemJobs.cleanup).toBe(configData.cleanupEnabled);
            expect(status.configHealth.systemJobs.healthCheck).toBe(configData.healthCheckEnabled);
            
            // Verify job consistency
            const jobs = daemon.scheduler.getAllJobs();
            const expectedJobCount = configData.siteCount + 
              (configData.cleanupEnabled ? 1 : 0) + 
              (configData.healthCheckEnabled ? 1 : 0);
            expect(jobs).toHaveLength(expectedJobCount);
            
            // Verify all jobs are enabled and properly configured
            for (const job of jobs) {
              expect(job.enabled).toBe(true);
              expect(job.cronExpression).toBeDefined();
              expect(job.description).toBeDefined();
            }
          }
          
        } finally {
          await daemon.stop();
        }
      }
    ), { numRuns: 30 });
  });

  /**
   * Property 8.5: Error Recovery Consistency
   * Validates: Requirement 2.3 - System recovers consistently from reload errors
   */
  test('Property 8.5: Error recovery should be consistent during failed reload attempts', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        validSiteCount: fc.integer({ min: 1, max: 3 }),
        errorType: fc.constantFrom(
          'invalid-yaml',
          'missing-sites',
          'invalid-site-structure'
        ),
        recoveryAttempts: fc.integer({ min: 1, max: 3 })
      }),
      async (testData) => {
        // Create initial valid configuration
        const validSites = Array.from({ length: testData.validSiteCount }, (_, index) => ({
          siteId: `valid-site-${index}`,
          siteName: `Valid Site ${index}`,
          domain: `valid${index}.com`,
          logPath: `/tmp/valid-${index}.log`,
          schedule: 'daily',
          enabled: true
        }));
        
        const validConfig = {
          version: '1.0',
          scheduler: { timezone: 'UTC', outputDir: './analytics' },
          sites: validSites,
          jobs: {
            cleanup: { schedule: 'daily', enabled: true, options: { maxAge: 7 } },
            healthCheck: { schedule: 'hourly', enabled: true }
          }
        };
        
        await fs.writeFile(configPath, yaml.dump(validConfig), 'utf8');
        
        const daemon = new SchedulerDaemon({
          configPath,
          watchConfig: false,
          schedulerOptions: { scheduled: false }
        });
        
        daemon.on('error', () => {});
        
        try {
          await daemon.start();
          
          // Verify initial valid state
          const initialStatus = daemon.getStatus();
          expect(initialStatus.configLoaded).toBe(true);
          expect(initialStatus.sites).toBe(testData.validSiteCount);
          const initialJobCount = daemon.scheduler.getAllJobs().length;
          
          // Attempt multiple failed reloads
          for (let attempt = 0; attempt < testData.recoveryAttempts; attempt++) {
            // Create invalid configuration based on error type
            let invalidContent;
            switch (testData.errorType) {
              case 'invalid-yaml':
                invalidContent = 'invalid: yaml: content: [unclosed';
                break;
              case 'missing-sites':
                invalidContent = yaml.dump({ version: '1.0' }); // Missing sites array
                break;
              case 'invalid-site-structure':
                invalidContent = yaml.dump({
                  version: '1.0',
                  sites: [{ invalidStructure: true }] // Missing required fields
                });
                break;
            }
            
            await fs.writeFile(configPath, invalidContent, 'utf8');
            
            // Attempt reload should fail
            await expect(daemon.manualConfigReload({ force: true })).rejects.toThrow();
            
            // Verify system maintains original state after failed reload
            const statusAfterFailure = daemon.getStatus();
            expect(statusAfterFailure.configLoaded).toBe(true);
            expect(statusAfterFailure.sites).toBe(testData.validSiteCount);
            expect(statusAfterFailure.isRunning).toBe(true);
            expect(statusAfterFailure.isShuttingDown).toBe(false);
            
            // Verify jobs are maintained
            const jobsAfterFailure = daemon.scheduler.getAllJobs();
            expect(jobsAfterFailure).toHaveLength(initialJobCount);
            
            // Verify all jobs are still functional
            for (const job of jobsAfterFailure) {
              expect(job.enabled).toBe(true);
              expect(job.cronExpression).toBeDefined();
            }
          }
          
          // Restore valid configuration and verify recovery
          await fs.writeFile(configPath, yaml.dump(validConfig), 'utf8');
          await daemon.manualConfigReload({ force: true });
          
          // Verify full recovery
          const finalStatus = daemon.getStatus();
          expect(finalStatus.configLoaded).toBe(true);
          expect(finalStatus.sites).toBe(testData.validSiteCount);
          expect(finalStatus.isRunning).toBe(true);
          
        } finally {
          await daemon.stop();
        }
      }
    ), { numRuns: 30 });
  });
});