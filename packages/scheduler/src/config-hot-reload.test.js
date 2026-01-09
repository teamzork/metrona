/**
 * @fileoverview Unit tests for configuration hot-reload functionality
 * Feature: metrona-analytics-system, Requirements 2.3
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { SchedulerDaemon } = require('./scheduler-daemon');

describe('Configuration Hot-Reload', () => {
  let daemon;
  let tempConfigDir;
  let configPath;
  
  beforeEach(async () => {
    // Create temporary directory for test configs
    tempConfigDir = path.join(__dirname, `test-config-${Date.now()}`);
    await fs.mkdir(tempConfigDir, { recursive: true });
    configPath = path.join(tempConfigDir, 'scheduler.yaml');
    
    // Create initial test configuration
    const initialConfig = {
      version: '1.0',
      scheduler: {
        timezone: 'UTC',
        outputDir: './test-analytics'
      },
      sites: [
        {
          siteId: 'test-site-1',
          siteName: 'Test Site 1',
          domain: 'test1.com',
          logPath: '/tmp/test1.log',
          schedule: 'daily',
          enabled: true
        }
      ],
      jobs: {
        cleanup: {
          schedule: 'daily',
          enabled: true,
          options: { maxAge: 7 }
        },
        healthCheck: {
          schedule: 'hourly',
          enabled: true
        }
      }
    };
    
    await fs.writeFile(configPath, yaml.dump(initialConfig), 'utf8');
    
    // Create daemon with test config
    daemon = new SchedulerDaemon({
      configPath,
      watchConfig: false, // Disable auto-watching for controlled tests
      schedulerOptions: { scheduled: false }
    });
    
    // Handle error events to prevent unhandled error exceptions
    daemon.on('error', () => {
      // Silently handle errors in tests - we're testing error conditions
    });
  });
  
  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
    }
    
    // Clean up temp directory
    try {
      await fs.rm(tempConfigDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Configuration Validation', () => {
    test('should validate valid configuration', async () => {
      await daemon.start();
      
      const status = daemon.getStatus();
      expect(status.configLoaded).toBe(true);
      expect(status.sites).toBe(1);
    });

    test('should reject configuration with invalid site ID', async () => {
      const invalidConfig = {
        version: '1.0',
        sites: [
          {
            siteId: '', // Invalid empty siteId
            siteName: 'Test Site',
            domain: 'test.com',
            logPath: '/tmp/test.log',
            schedule: 'daily'
          }
        ]
      };
      
      await fs.writeFile(configPath, yaml.dump(invalidConfig), 'utf8');
      
      await expect(daemon.start()).rejects.toThrow('Each site must have a valid siteId');
    });

    test('should reject configuration with invalid domain format', async () => {
      const invalidConfig = {
        version: '1.0',
        sites: [
          {
            siteId: 'test-site',
            siteName: 'Test Site',
            domain: 'invalid..domain', // Invalid domain format
            logPath: '/tmp/test.log',
            schedule: 'daily'
          }
        ]
      };
      
      await fs.writeFile(configPath, yaml.dump(invalidConfig), 'utf8');
      
      await expect(daemon.start()).rejects.toThrow("Invalid domain format: invalid..domain");
    });

    test('should reject configuration with invalid cron schedule', async () => {
      const invalidConfig = {
        version: '1.0',
        sites: [
          {
            siteId: 'test-site',
            siteName: 'Test Site',
            domain: 'test.com',
            logPath: '/tmp/test.log',
            schedule: 'invalid-schedule' // Invalid schedule
          }
        ]
      };
      
      await fs.writeFile(configPath, yaml.dump(invalidConfig), 'utf8');
      
      await expect(daemon.start()).rejects.toThrow("Unknown schedule format: invalid-schedule");
    });
  });

  describe('Configuration Reload', () => {
    test('should successfully reload valid configuration changes', async () => {
      await daemon.start();
      
      // Verify initial state
      let status = daemon.getStatus();
      expect(status.sites).toBe(1);
      expect(daemon.scheduler.getAllJobs()).toHaveLength(3); // 1 site + 2 system jobs
      
      // Update configuration with additional site
      const updatedConfig = {
        version: '1.0',
        scheduler: {
          timezone: 'UTC',
          outputDir: './test-analytics'
        },
        sites: [
          {
            siteId: 'test-site-1',
            siteName: 'Test Site 1',
            domain: 'test1.com',
            logPath: '/tmp/test1.log',
            schedule: 'daily',
            enabled: true
          },
          {
            siteId: 'test-site-2',
            siteName: 'Test Site 2',
            domain: 'test2.com',
            logPath: '/tmp/test2.log',
            schedule: 'hourly',
            enabled: true
          }
        ],
        jobs: {
          cleanup: {
            schedule: 'daily',
            enabled: true,
            options: { maxAge: 7 }
          },
          healthCheck: {
            schedule: 'hourly',
            enabled: true
          }
        }
      };
      
      await fs.writeFile(configPath, yaml.dump(updatedConfig), 'utf8');
      
      // Manually trigger reload
      await daemon.manualConfigReload();
      
      // Verify updated state
      status = daemon.getStatus();
      expect(status.sites).toBe(2);
      expect(daemon.scheduler.getAllJobs()).toHaveLength(4); // 2 sites + 2 system jobs
      
      // Verify specific jobs exist
      const jobs = daemon.scheduler.getAllJobs();
      const jobIds = jobs.map(job => job.jobId);
      expect(jobIds).toContain('site-test-site-1');
      expect(jobIds).toContain('site-test-site-2');
      expect(jobIds).toContain('system-cleanup');
      expect(jobIds).toContain('system-health-check');
    });

    test('should handle configuration reload failure and maintain old config', async () => {
      await daemon.start();
      
      // Verify initial state
      const initialJobCount = daemon.scheduler.getAllJobs().length;
      expect(initialJobCount).toBe(3);
      
      // Write invalid configuration
      const invalidConfig = {
        version: '1.0',
        sites: [
          {
            siteId: '', // Invalid empty siteId
            siteName: 'Invalid Site',
            domain: 'test.com',
            logPath: '/tmp/test.log',
            schedule: 'daily'
          }
        ]
      };
      
      await fs.writeFile(configPath, yaml.dump(invalidConfig), 'utf8');
      
      // Attempt reload should fail
      await expect(daemon.manualConfigReload()).rejects.toThrow('Configuration validation failed');
      
      // Verify old configuration is maintained
      const status = daemon.getStatus();
      expect(status.sites).toBe(1); // Still has original site
      expect(daemon.scheduler.getAllJobs()).toHaveLength(initialJobCount); // Same job count
    });

    test('should handle job scheduling failure and recover', async () => {
      await daemon.start();
      
      // Mock job scheduler to fail on next scheduling attempt
      const originalScheduleJob = daemon.scheduler.scheduleJob;
      daemon.scheduler.scheduleJob = jest.fn().mockImplementation(() => {
        throw new Error('Mock scheduling failure');
      });
      
      // Update configuration
      const updatedConfig = {
        version: '1.0',
        sites: [
          {
            siteId: 'new-site',
            siteName: 'New Site',
            domain: 'new.com',
            logPath: '/tmp/new.log',
            schedule: 'daily',
            enabled: true
          }
        ]
      };
      
      await fs.writeFile(configPath, yaml.dump(updatedConfig), 'utf8');
      
      // Reload should fail but recover
      await expect(daemon.manualConfigReload()).rejects.toThrow('Mock scheduling failure');
      
      // Restore original scheduler function
      daemon.scheduler.scheduleJob = originalScheduleJob;
      
      // Verify recovery - should still have original jobs
      const status = daemon.getStatus();
      expect(status.sites).toBe(1); // Back to original site
    });

    test('should skip reload if file has not been modified', async () => {
      await daemon.start();
      
      const reloadEvents = [];
      daemon.on('manualConfigReloadSkipped', (event) => {
        reloadEvents.push(event);
      });
      
      // Attempt reload without force
      await daemon.manualConfigReload({ force: false });
      
      // Should skip because file hasn't been modified
      expect(reloadEvents).toHaveLength(1);
      expect(reloadEvents[0].reason).toBe('File not modified since last load');
    });

    test('should force reload even if file has not been modified', async () => {
      await daemon.start();
      
      const reloadEvents = [];
      daemon.on('manualConfigReloadCompleted', (event) => {
        reloadEvents.push(event);
      });
      
      // Force reload
      await daemon.manualConfigReload({ force: true });
      
      // Should complete reload
      expect(reloadEvents).toHaveLength(1);
      expect(reloadEvents[0].force).toBe(true);
    });
  });

  describe('Configuration Watcher', () => {
    test('should setup and teardown config watcher properly', async () => {
      // Create daemon with watching enabled
      const watchingDaemon = new SchedulerDaemon({
        configPath,
        watchConfig: true,
        schedulerOptions: { scheduled: false }
      });
      
      await watchingDaemon.start();
      
      const status = watchingDaemon.getStatus();
      expect(status.watchingConfig).toBe(true);
      
      await watchingDaemon.stop();
      
      const stoppedStatus = watchingDaemon.getStatus();
      expect(stoppedStatus.watchingConfig).toBe(false);
    });

    test('should emit appropriate events during config watching', async () => {
      const watchingDaemon = new SchedulerDaemon({
        configPath,
        watchConfig: true,
        schedulerOptions: { scheduled: false }
      });
      
      const events = [];
      watchingDaemon.on('configWatcherStarted', (event) => events.push({ type: 'started', ...event }));
      
      await watchingDaemon.start();
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('started');
      expect(events[0].path).toBe(configPath);
      
      await watchingDaemon.stop();
    });
  });

  describe('Status Reporting', () => {
    test('should provide comprehensive status information', async () => {
      await daemon.start();
      
      const status = daemon.getStatus();
      
      // Basic status
      expect(status.isRunning).toBe(true);
      expect(status.configLoaded).toBe(true);
      expect(status.sites).toBe(1);
      
      // Configuration health
      expect(status.configHealth).toBeDefined();
      expect(status.configHealth.version).toBe('1.0');
      expect(status.configHealth.enabledSites).toBe(1);
      expect(status.configHealth.totalSites).toBe(1);
      expect(status.configHealth.systemJobs.cleanup).toBe(true);
      expect(status.configHealth.systemJobs.healthCheck).toBe(true);
      
      // Job summary
      expect(status.jobSummary).toBeDefined();
      expect(status.jobSummary.total).toBe(3);
      expect(status.jobSummary.enabled).toBe(3);
      expect(status.jobSummary.running).toBe(0);
      expect(status.jobSummary.withErrors).toBe(0);
    });

    test('should handle status when config is not loaded', () => {
      const status = daemon.getStatus();
      
      expect(status.isRunning).toBe(false);
      expect(status.configLoaded).toBe(false);
      expect(status.sites).toBe(0);
      expect(status.configHealth).toBeUndefined();
    });
  });

  describe('Error Recovery', () => {
    test('should handle missing configuration file gracefully', async () => {
      // Delete config file
      await fs.unlink(configPath);
      
      // Should create default config and start successfully
      await daemon.start();
      
      const status = daemon.getStatus();
      expect(status.configLoaded).toBe(true);
      expect(status.sites).toBe(1); // Default config has one example site
    });

    test('should handle corrupted YAML file', async () => {
      // Write corrupted YAML
      await fs.writeFile(configPath, 'invalid: yaml: content: [unclosed', 'utf8');
      
      await expect(daemon.start()).rejects.toThrow('Failed to load configuration');
    });

    test('should validate critical jobs after reload', async () => {
      await daemon.start();
      
      // Update configuration
      const updatedConfig = {
        version: '1.0',
        sites: [
          {
            siteId: 'critical-site',
            siteName: 'Critical Site',
            domain: 'critical.com',
            logPath: '/tmp/critical.log',
            schedule: 'daily',
            enabled: true
          }
        ]
      };
      
      await fs.writeFile(configPath, yaml.dump(updatedConfig), 'utf8');
      
      // Mock scheduler to simulate missing critical job after scheduling
      const originalGetAllJobs = daemon.scheduler.getAllJobs;
      daemon.scheduler.getAllJobs = jest.fn().mockReturnValue([]);
      
      // Reload should fail due to missing critical job
      await expect(daemon.manualConfigReload()).rejects.toThrow();
      
      // Restore original function
      daemon.scheduler.getAllJobs = originalGetAllJobs;
    });
  });
});