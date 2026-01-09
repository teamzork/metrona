/**
 * @fileoverview Integration tests for scheduler components
 * Feature: metrona-analytics-system
 */

const fs = require('fs').promises;
const path = require('path');
const { JobScheduler } = require('./job-scheduler');
const { JobExecutor } = require('./job-executor');

describe('Scheduler Integration Tests', () => {
  let testOutputDir;
  let testLogFile;
  let scheduler;
  let executor;

  beforeEach(async () => {
    // Create temporary directories and files
    testOutputDir = path.join(__dirname, 'integration-test-output-' + Date.now());
    testLogFile = path.join(testOutputDir, 'test.log');
    
    await fs.mkdir(testOutputDir, { recursive: true });
    
    // Create sample log file
    const sampleLogEntries = [
      '192.168.1.1 - - [08/Jan/2026:10:00:00 +0000] "GET /home HTTP/1.1" 200 2048 "https://google.com/search" "Mozilla/5.0"',
      '192.168.1.2 - - [08/Jan/2026:10:15:00 +0000] "GET /about HTTP/1.1" 200 1536 "-" "Mozilla/5.0"',
      '192.168.1.1 - - [08/Jan/2026:11:00:00 +0000] "GET /contact HTTP/1.1" 200 1024 "https://facebook.com" "Mozilla/5.0"'
    ];
    
    await fs.writeFile(testLogFile, sampleLogEntries.join('\n') + '\n', 'utf8');
    
    // Initialize components
    scheduler = new JobScheduler({ scheduled: false });
    executor = new JobExecutor({ outputDir: testOutputDir });
    
    // Handle error events
    scheduler.on('error', () => {});
  });

  afterEach(async () => {
    // Clean up
    if (scheduler) {
      await scheduler.shutdown(1000);
    }
    
    try {
      const files = await fs.readdir(testOutputDir);
      for (const file of files) {
        await fs.unlink(path.join(testOutputDir, file));
      }
      await fs.rmdir(testOutputDir);
    } catch (error) {
      // Directory might not exist or already cleaned up
    }
  });

  describe('JobExecutor', () => {
    it('should create and execute site processing job successfully', async () => {
      const siteConfig = {
        siteId: 'test-site',
        siteName: 'Test Site',
        domain: 'test.com',
        logPath: testLogFile
      };
      
      // Create job function
      const jobFunction = executor.createSiteProcessingJob(siteConfig);
      
      // Execute the job
      const result = await jobFunction();
      
      expect(result.success).toBe(true);
      expect(result.siteId).toBe('test-site');
      expect(result.entriesProcessed).toBe(3);
      expect(result.analytics.totalPageviews).toBe(3);
      expect(result.analytics.uniqueVisitors).toBe(2);
      expect(result.outputPath).toContain('test-site');
      
      // Verify YAML file was created
      const yamlExists = await fs.access(result.outputPath).then(() => true).catch(() => false);
      expect(yamlExists).toBe(true);
    });

    it('should handle invalid site configuration', () => {
      const invalidSiteConfig = {
        siteId: 'test-site',
        // Missing required fields
      };
      
      expect(() => {
        executor.createSiteProcessingJob(invalidSiteConfig);
      }).toThrow('Site configuration must have a valid siteName string');
    });

    it('should create cleanup job successfully', async () => {
      const cleanupJob = executor.createCleanupJob({ maxAge: 1 });
      
      const result = await cleanupJob();
      
      expect(result.success).toBe(true);
      expect(typeof result.cleanedFiles).toBe('number');
      expect(result.maxAge).toBe(1);
    });

    it('should create health check job successfully', async () => {
      const siteConfigs = [
        {
          siteId: 'test-site',
          siteName: 'Test Site',
          domain: 'test.com',
          logPath: testLogFile
        }
      ];
      
      const healthCheckJob = executor.createHealthCheckJob(siteConfigs);
      
      const result = await healthCheckJob();
      
      expect(result.totalSites).toBe(1);
      expect(result.healthySites).toBe(1);
      expect(result.unhealthySites).toBe(0);
      expect(result.sites).toHaveLength(1);
      expect(result.sites[0].status).toBe('healthy');
      expect(result.sites[0].siteId).toBe('test-site');
    });
  });

  describe('JobScheduler + JobExecutor Integration', () => {
    it('should schedule and execute site processing job', async () => {
      const siteConfig = {
        siteId: 'integration-test',
        siteName: 'Integration Test Site',
        domain: 'integration.test',
        logPath: testLogFile
      };
      
      // Create job function
      const jobFunction = executor.createSiteProcessingJob(siteConfig);
      
      // Schedule the job
      const scheduled = scheduler.scheduleJob(
        'integration-test-job',
        '* * * * *', // Every minute
        jobFunction,
        { description: 'Integration test job' }
      );
      
      expect(scheduled).toBe(true);
      
      // Verify job is scheduled
      const jobInfo = scheduler.getJobInfo('integration-test-job');
      expect(jobInfo).not.toBeNull();
      expect(jobInfo.description).toBe('Integration test job');
      
      // Manually execute the job to test integration
      let jobResult = null;
      const completedPromise = new Promise((resolve) => {
        scheduler.on('jobCompleted', (data) => {
          if (data.jobId === 'integration-test-job') {
            resolve(data);
          }
        });
      });
      
      // Execute the job manually
      await scheduler.executeJob('integration-test-job', jobFunction, { siteConfig });
      
      // Wait for completion event
      const completedData = await completedPromise;
      
      expect(completedData.success).toBe(true);
      expect(completedData.jobId).toBe('integration-test-job');
      
      // Verify job statistics were updated
      const updatedJobInfo = scheduler.getJobInfo('integration-test-job');
      expect(updatedJobInfo.runCount).toBe(1);
      expect(updatedJobInfo.successCount).toBe(1);
      expect(updatedJobInfo.errorCount).toBe(0);
    });

    it('should handle job execution failures gracefully', async () => {
      // Create a job that will fail
      const failingJob = async () => {
        throw new Error('Simulated job failure');
      };
      
      scheduler.scheduleJob('failing-job', '* * * * *', failingJob);
      
      // Execute the failing job
      let errorData = null;
      const errorPromise = new Promise((resolve) => {
        scheduler.on('error', (data) => {
          if (data.jobId === 'failing-job') {
            resolve(data);
          }
        });
      });
      
      await scheduler.executeJob('failing-job', failingJob, {});
      
      // Wait for error event
      errorData = await errorPromise;
      
      expect(errorData.type).toBe('jobExecutionError');
      expect(errorData.error).toBe('Simulated job failure');
      
      // Verify job statistics reflect the failure
      const jobInfo = scheduler.getJobInfo('failing-job');
      expect(jobInfo.runCount).toBe(1);
      expect(jobInfo.successCount).toBe(0);
      expect(jobInfo.errorCount).toBe(1);
      expect(jobInfo.lastError.message).toBe('Simulated job failure');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing log file gracefully', async () => {
      const siteConfig = {
        siteId: 'missing-log-site',
        siteName: 'Missing Log Site',
        domain: 'missing.test',
        logPath: '/nonexistent/path/to/log.file'
      };
      
      const jobFunction = executor.createSiteProcessingJob(siteConfig);
      
      await expect(jobFunction()).rejects.toThrow();
    });

    it('should validate site configuration thoroughly', () => {
      const testCases = [
        { config: null, expectedError: 'Site configuration must be an object' },
        { config: {}, expectedError: 'Site configuration must have a valid siteId string' },
        { config: { siteId: '' }, expectedError: 'Site configuration must have a valid siteId string' },
        { config: { siteId: 'test' }, expectedError: 'Site configuration must have a valid siteName string' },
        { config: { siteId: 'test', siteName: 'Test' }, expectedError: 'Site configuration must have a valid domain string' },
        { config: { siteId: 'test', siteName: 'Test', domain: 'invalid-domain-format!', logPath: '/tmp/test.log' }, expectedError: 'Invalid domain format' },
        { config: { siteId: 'test', siteName: 'Test', domain: 'test.com' }, expectedError: 'Site configuration must have a valid logPath string' }
      ];
      
      testCases.forEach(({ config, expectedError }) => {
        expect(() => {
          executor.createSiteProcessingJob(config);
        }).toThrow(expectedError);
      });
    });
  });

  describe('Statistics and State Management', () => {
    it('should track processing statistics correctly', async () => {
      const siteConfig = {
        siteId: 'stats-test',
        siteName: 'Stats Test Site',
        domain: 'stats.test',
        logPath: testLogFile
      };
      
      const initialStats = executor.getStats();
      expect(initialStats.totalSitesProcessed).toBe(0);
      expect(initialStats.totalLogEntriesProcessed).toBe(0);
      
      // Execute job
      const jobFunction = executor.createSiteProcessingJob(siteConfig);
      await jobFunction();
      
      const updatedStats = executor.getStats();
      expect(updatedStats.totalSitesProcessed).toBe(1);
      expect(updatedStats.totalLogEntriesProcessed).toBe(3);
      expect(updatedStats.lastProcessingTime).toBeInstanceOf(Date);
    });

    it('should manage site processing positions', () => {
      const siteId = 'position-test';
      
      // Initially no position
      expect(executor.resetSitePosition(siteId)).toBe(false);
      
      // Set position
      executor.setSitePosition(siteId, 1000);
      
      // Reset position
      expect(executor.resetSitePosition(siteId)).toBe(true);
      
      const stats = executor.getStats();
      expect(stats.lastProcessedPositions[siteId]).toBe(0);
    });
  });
});