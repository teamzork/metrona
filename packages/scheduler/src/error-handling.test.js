/**
 * @fileoverview Unit tests for enhanced error handling and logging
 * Feature: metrona-analytics-system, Requirements 2.5, 10.1, 10.2, 10.4
 */

const { JobScheduler } = require('./job-scheduler');
const { JobExecutor } = require('./job-executor');
const { SchedulerDaemon } = require('./scheduler-daemon');
const fs = require('fs').promises;
const path = require('path');

describe('Enhanced Error Handling and Logging', () => {
  let tempDir;
  
  beforeEach(async () => {
    // Create temporary directory for test files
    tempDir = path.join(__dirname, '..', '..', '..', 'test-temp', `error-handling-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });
  
  afterEach(async () => {
    // Clean up temporary files
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('JobScheduler Error Handling', () => {
    let scheduler;
    
    beforeEach(() => {
      scheduler = new JobScheduler();
    });
    
    afterEach(async () => {
      await scheduler.shutdown(1000);
    });

    test('should categorize file system errors correctly', () => {
      const fileNotFoundError = new Error('ENOENT: no such file or directory');
      expect(scheduler.categorizeError(fileNotFoundError)).toBe('file_not_found');
      
      const permissionError = new Error('EACCES: permission denied');
      expect(scheduler.categorizeError(permissionError)).toBe('permission_denied');
      
      const resourceError = new Error('EMFILE: too many open files');
      expect(scheduler.categorizeError(resourceError)).toBe('resource_exhaustion');
    });

    test('should categorize network errors correctly', () => {
      const connectionError = new Error('ECONNREFUSED: connection refused');
      expect(scheduler.categorizeError(connectionError)).toBe('connection_refused');
      
      const timeoutError = new Error('ETIMEDOUT: operation timed out');
      expect(scheduler.categorizeError(timeoutError)).toBe('timeout');
    });

    test('should categorize job-specific errors correctly', () => {
      const timeoutError = new Error('Job execution timeout after 5000ms');
      expect(scheduler.categorizeError(timeoutError)).toBe('timeout');
      
      const validationError = new Error('Invalid configuration format');
      expect(scheduler.categorizeError(validationError)).toBe('configuration_error'); // Fixed: should be 'configuration_error'
    });

    test('should emit structured log events on job errors', async () => {
      // Add error handler to prevent unhandled errors
      scheduler.on('error', () => {
        // Ignore errors for this test - we expect them
      });
      
      const jobFunction = async () => {
        throw new Error('Test job error');
      };
      
      const logPromise = new Promise((resolve) => {
        scheduler.on('structuredLog', (logEntry) => {
          expect(logEntry.level).toBe('ERROR');
          expect(logEntry.component).toBe('JobScheduler');
          expect(logEntry.message).toBe('Test job error');
          expect(logEntry.timestamp).toBeDefined();
          resolve();
        });
      });
      
      scheduler.scheduleJob('test-error-job', '* * * * * *', jobFunction);
      
      // Manually execute the job to trigger the error
      await scheduler.executeJob('test-error-job', jobFunction, {});
      
      await logPromise;
    });

    test('should handle job timeout correctly', async () => {
      // Add error handler to prevent unhandled errors
      scheduler.on('error', () => {
        // Ignore errors for this test - we expect them
      });
      
      const slowJobFunction = async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return 'completed';
      };
      
      const jobCompleted = new Promise((resolve) => {
        scheduler.on('jobCompleted', (data) => {
          if (data.jobId === 'timeout-test-job') {
            resolve(data);
          }
        });
      });
      
      scheduler.scheduleJob('timeout-test-job', '* * * * * *', slowJobFunction);
      
      // Manually execute with short timeout
      await scheduler.executeJob('timeout-test-job', slowJobFunction, { timeout: 100 });
      
      const result = await jobCompleted;
      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('timeout');
    });

    test('should sanitize job results for logging', () => {
      const sensitiveResult = {
        success: true,
        outputPath: '/home/user/sensitive/path/file.yaml',
        analytics: {
          totalPageviews: 1000,
          uniqueVisitors: 500,
          totalPages: 50,
          sensitiveData: 'should be removed'
        }
      };
      
      const sanitized = scheduler.sanitizeJobResult(sensitiveResult);
      
      expect(sanitized.outputPath).toBe('/home/***/sensitive/path/file.yaml');
      expect(sanitized.analytics.totalPageviews).toBe(1000);
      expect(sanitized.analytics.sensitiveData).toBeUndefined();
    });

    test('should sanitize context data for logging', () => {
      const sensitiveContext = {
        batchSize: 1000,
        timeout: 5000,
        siteConfig: {
          siteId: 'test-site',
          domain: 'example.com',
          logPath: '/var/log/nginx/access.log',
          secretKey: 'should-not-be-logged'
        },
        apiKey: 'secret-key'
      };
      
      const sanitized = scheduler.sanitizeContext(sensitiveContext);
      
      expect(sanitized.batchSize).toBe(1000);
      expect(sanitized.timeout).toBe(5000);
      expect(sanitized.siteConfig.siteId).toBe('test-site');
      expect(sanitized.siteConfig.hasLogPath).toBe(true);
      expect(sanitized.siteConfig.logPath).toBeUndefined();
      expect(sanitized.siteConfig.secretKey).toBeUndefined();
      expect(sanitized.apiKey).toBeUndefined();
    });
  });

  describe('JobExecutor Error Handling', () => {
    let executor;
    let testLogFile;
    
    beforeEach(async () => {
      executor = new JobExecutor({
        outputDir: tempDir,
        timezone: 'UTC'
      });
      
      testLogFile = path.join(tempDir, 'test.log');
      await fs.writeFile(testLogFile, '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"\n');
    });

    test('accepts the domains the config accepts, one-letter labels included', () => {
      const site = { siteId: 's', siteName: 'S', logPath: testLogFile };
      for (const domain of ['x.com', 'b.example.org', 'example.com', 'a-b.c.io']) {
        expect(() => executor.validateSiteConfig({ ...site, domain })).not.toThrow();
      }
      for (const domain of ['-x.com', 'x-.com', 'a..b', '.example.com']) {
        expect(() => executor.validateSiteConfig({ ...site, domain })).toThrow(/Invalid domain format/);
      }
    });

    test('should perform pre-flight checks correctly', async () => {
      const validConfig = {
        siteId: 'test-site',
        siteName: 'Test Site',
        domain: 'example.com',
        logPath: testLogFile
      };
      
      // Should not throw for valid config
      await expect(executor.performPreflightChecks(validConfig)).resolves.toBeUndefined();
      
      // Should throw for missing file
      const invalidConfig = {
        ...validConfig,
        logPath: path.join(tempDir, 'nonexistent.log')
      };
      
      await expect(executor.performPreflightChecks(invalidConfig))
        .rejects.toThrow('Log file not found');
    });

    test('should handle log parsing errors gracefully', () => {
      const processingErrors = [];
      
      // Valid log line
      const validResult = executor.parseLineWithErrorHandling(
        '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"',
        'test-site',
        processingErrors
      );
      expect(validResult).not.toBeNull();
      expect(processingErrors).toHaveLength(0);
      
      // Invalid log line - should be handled gracefully with a warning
      const invalidResult = executor.parseLineWithErrorHandling(
        'completely invalid log line format that cannot be parsed',
        'test-site',
        processingErrors
      );
      expect(invalidResult).toBeNull();
      expect(processingErrors).toHaveLength(1);
      expect(processingErrors[0].error).toBe('Invalid log line format - skipped');
      expect(processingErrors[0].severity).toBe('warning');
      expect(processingErrors[0].line).toContain('completely invalid');
    });

    test('should categorize processing errors correctly', () => {
      const fileNotFoundError = new Error('Log file not found: /path/to/file');
      expect(executor.categorizeProcessingError(fileNotFoundError)).toBe('file_not_found');
      
      const permissionError = new Error('Permission denied accessing file');
      expect(executor.categorizeProcessingError(permissionError)).toBe('permission_denied');
      
      const yamlError = new Error('YAML generation failed due to invalid data');
      expect(executor.categorizeProcessingError(yamlError)).toBe('yaml_generation_error');
      
      const initError = new Error('Failed to initialize log reader');
      expect(executor.categorizeProcessingError(initError)).toBe('initialization_error');
    });

    test('should sanitize context data correctly', () => {
      const context = {
        batchSize: 1000,
        timeout: 5000,
        maxMemoryMB: 100,
        secretKey: 'should-be-removed',
        apiToken: 'also-removed'
      };
      
      const sanitized = executor.sanitizeContext(context);
      
      expect(sanitized.batchSize).toBe(1000);
      expect(sanitized.timeout).toBe(5000);
      expect(sanitized.maxMemoryMB).toBe(100);
      expect(sanitized.secretKey).toBeUndefined();
      expect(sanitized.apiToken).toBeUndefined();
    });

    test('should create site processing job with error isolation', async () => {
      const siteConfig = {
        siteId: 'test-site',
        siteName: 'Test Site',
        domain: 'example.com',
        logPath: testLogFile,
        parserOptions: {
          topContentLimit: 10,
          referrerLimit: 5
        }
      };
      
      const jobFunction = executor.createSiteProcessingJob(siteConfig);
      expect(typeof jobFunction).toBe('function');
      
      // Test that job function handles errors gracefully
      const invalidSiteConfig = {
        ...siteConfig,
        logPath: path.join(tempDir, 'nonexistent.log')
      };
      
      const invalidJobFunction = executor.createSiteProcessingJob(invalidSiteConfig);
      
      await expect(invalidJobFunction()).rejects.toThrow('Failed to process analytics');
    });
  });

  describe('SchedulerDaemon Error Handling', () => {
    let daemon;
    let configPath;
    
    beforeEach(async () => {
      configPath = path.join(tempDir, 'scheduler.yaml');
      
      daemon = new SchedulerDaemon({
        configPath,
        outputDir: tempDir,
        watchConfig: false // Disable file watching for tests
      });
    });
    
    afterEach(async () => {
      if (daemon.isRunning) {
        await daemon.stop();
      }
    });

    test('should emit structured log events', (done) => {
      const testData = {
        message: 'Test event',
        context: { test: true }
      };
      
      daemon.on('structuredLog', (logEntry) => {
        expect(logEntry.level).toBe('INFO');
        expect(logEntry.component).toBe('SchedulerDaemon');
        expect(logEntry.eventType).toBe('TestEvent');
        expect(logEntry.data.message).toBe('Test event');
        done();
      });
      
      daemon.logStructuredEvent('INFO', 'TestEvent', testData);
    });

    test('should sanitize log data correctly', () => {
      const sensitiveData = {
        configPath: '/home/user/config/scheduler.yaml',
        outputPath: '/home/user/output/analytics.yaml',
        stack: 'Error stack trace...',
        context: {
          field1: 'value1',
          field2: 'value2',
          field3: 'value3',
          field4: 'value4',
          field5: 'value5',
          field6: 'value6',
          field7: 'value7'
        }
      };
      
      const sanitized = daemon.sanitizeLogData(sensitiveData);
      
      expect(sanitized.configPath).toBe('/home/***/config/scheduler.yaml');
      expect(sanitized.outputPath).toBe('/home/***/output/analytics.yaml');
      
      // Context should be limited to 5 fields
      const contextKeys = Object.keys(sanitized.context);
      expect(contextKeys.length).toBe(6); // 5 fields + '...' indicator
      expect(sanitized.context['...']).toBe('2 more fields');
    });

    test('should handle configuration validation errors gracefully', async () => {
      // Create invalid configuration
      const invalidConfig = {
        version: '1.0',
        sites: 'invalid-should-be-array'
      };
      
      await fs.writeFile(configPath, JSON.stringify(invalidConfig));
      
      const validationErrors = [];
      daemon.on('error', (data) => {
        if (data.type === 'startupError') {
          validationErrors.push(data);
        }
      });
      
      await expect(daemon.start()).rejects.toThrow('Configuration must have a sites array');
      expect(validationErrors.length).toBeGreaterThan(0);
    });

    test('should create default configuration when file is missing', async () => {
      // Ensure config file doesn't exist
      try {
        await fs.unlink(configPath);
      } catch (error) {
        // File doesn't exist, which is what we want
      }
      
      await daemon.start();
      
      // Check that default config was created
      const configExists = await fs.access(configPath).then(() => true).catch(() => false);
      expect(configExists).toBe(true);
      
      // Verify config content
      const configContent = await fs.readFile(configPath, 'utf8');
      const config = require('js-yaml').load(configContent);
      expect(config.version).toBe('1.0');
      expect(Array.isArray(config.sites)).toBe(true);
    });
  });

  describe('Error Isolation Between Jobs (Requirement 10.4)', () => {
    let scheduler;
    
    beforeEach(() => {
      scheduler = new JobScheduler();
      
      // Handle error events to prevent unhandled errors
      scheduler.on('error', () => {
        // Ignore errors for this test - we expect them
      });
    });
    
    afterEach(async () => {
      await scheduler.shutdown(1000);
    });

    test('should continue processing other jobs when one job fails', async () => {
      const jobResults = [];
      
      scheduler.on('jobCompleted', (data) => {
        jobResults.push(data);
      });
      
      // Create jobs: one that fails, one that succeeds
      const failingJob = async () => {
        throw new Error('This job always fails');
      };
      
      const successfulJob = async () => {
        return { success: true, message: 'Job completed successfully' };
      };
      
      // Schedule both jobs
      scheduler.scheduleJob('failing-job', '* * * * * *', failingJob);
      scheduler.scheduleJob('successful-job', '* * * * * *', successfulJob);
      
      // Manually execute both jobs
      await scheduler.executeJob('failing-job', failingJob, {});
      await scheduler.executeJob('successful-job', successfulJob, {});
      
      // Wait for both jobs to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(jobResults).toHaveLength(2);
      
      const failedJob = jobResults.find(r => r.jobId === 'failing-job');
      const succeededJob = jobResults.find(r => r.jobId === 'successful-job');
      
      expect(failedJob.success).toBe(false);
      expect(succeededJob.success).toBe(true);
      
      // Verify scheduler statistics show both attempts
      const stats = scheduler.getStats();
      expect(stats.successfulRuns).toBe(1);
      expect(stats.failedRuns).toBe(1);
    });
  });

  describe('Structured Error Logging (Requirement 2.5)', () => {
    let scheduler;
    let logEntries;
    
    beforeEach(() => {
      scheduler = new JobScheduler();
      logEntries = [];
      
      scheduler.on('structuredLog', (entry) => {
        logEntries.push(entry);
      });
      
      // Handle error events to prevent unhandled errors
      scheduler.on('error', () => {
        // Ignore errors for this test - we expect them
      });
    });
    
    afterEach(async () => {
      await scheduler.shutdown(1000);
    });

    test('should log detailed error information for troubleshooting', async () => {
      const complexError = new Error('Complex processing error');
      complexError.stack = 'Error: Complex processing error\n    at test.js:123:45';
      
      const jobFunction = async (context) => {
        throw complexError;
      };
      
      scheduler.scheduleJob('complex-error-job', '* * * * * *', jobFunction);
      await scheduler.executeJob('complex-error-job', jobFunction, { 
        batchSize: 1000,
        siteConfig: { siteId: 'test-site' }
      });
      
      // Wait for logging to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(logEntries).toHaveLength(1);
      
      const logEntry = logEntries[0];
      expect(logEntry.level).toBe('ERROR');
      expect(logEntry.component).toBe('JobScheduler');
      expect(logEntry.jobId).toBe('complex-error-job');
      expect(logEntry.message).toBe('Complex processing error');
      expect(logEntry.stackTrace).toContain('test.js:123:45');
      expect(logEntry.context).toBeDefined();
      expect(logEntry.timestamp).toBeDefined();
    });
  });
});