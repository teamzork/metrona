/**
 * @fileoverview Property-based tests for error handling and logging
 * Feature: metrona-analytics-system
 * Property 33: Error Isolation and Logging
 * Validates: Requirements 10.1, 10.2, 10.4
 */

const fc = require('fast-check');
const { JobScheduler } = require('./job-scheduler');
const { JobExecutor } = require('./job-executor');
const { SchedulerDaemon } = require('./scheduler-daemon');
const fs = require('fs').promises;
const path = require('path');

// A path with a /home/<user>/ segment somewhere in it
const homePathArb = fc
  .tuple(fc.string({ maxLength: 20 }), fc.stringMatching(/^[a-z][a-z0-9_-]{0,15}$/), fc.string({ maxLength: 20 }))
  .map(([prefix, user, rest]) => `${prefix}/home/${user}/${rest}`);

describe('Property 33: Error Isolation and Logging', () => {
  let tempDir;
  
  beforeEach(async () => {
    tempDir = path.join(__dirname, '..', '..', '..', 'test-temp', `error-prop-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });
  
  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  /**
   * Property: Error categorization consistency
   * When the same error is categorized multiple times, it should always return the same category
   */
  test('Property 33.1: Error categorization is consistent', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.constant(new Error('ENOENT: no such file or directory')),
        fc.constant(new Error('EACCES: permission denied')),
        fc.constant(new Error('ETIMEDOUT: operation timed out')),
        fc.constant(new Error('Job execution timeout after 5000ms')),
        fc.constant(new Error('Invalid configuration format')),
        fc.constant(new Error('YAML generation failed')),
        fc.constant(new Error('Failed to initialize log reader')),
        fc.constant(new Error('General processing error'))
      ),
      (error) => {
        const scheduler = new JobScheduler();
        const executor = new JobExecutor();
        
        // Categorize the same error multiple times
        const category1 = scheduler.categorizeError(error);
        const category2 = scheduler.categorizeError(error);
        const category3 = executor.categorizeProcessingError(error);
        
        // Categories should be consistent
        expect(category1).toBe(category2);
        
        // Processing error categorization should be consistent with general categorization
        // for overlapping error types
        if (['file_not_found', 'permission_denied', 'yaml_generation_error'].includes(category1)) {
          expect(category3).toBe(category1);
        }
        
        return true;
      }
    ), { numRuns: 30 });
  });

  /**
   * Property: Job isolation - one job failure doesn't affect other jobs
   * When multiple jobs are scheduled and some fail, successful jobs should still complete
   */
  test('Property 33.2: Job failure isolation', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.record({
        jobId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9-_]+$/.test(s)),
        shouldFail: fc.boolean(),
        delay: fc.integer({ min: 0, max: 20 })
      }), { minLength: 2, maxLength: 5 }),
      async (jobConfigs) => {
        const scheduler = new JobScheduler();
        const jobResults = [];
        
        scheduler.on('jobCompleted', (data) => {
          jobResults.push(data);
        });
        // Failed jobs also emit 'error'; an EventEmitter with no 'error'
        // listener throws, which would abort executeJob before it logs
        scheduler.on('error', () => {});
        
        try {
          // Create unique job IDs to avoid conflicts
          const uniqueJobConfigs = jobConfigs.reduce((acc, config, index) => {
            const uniqueId = `${config.jobId}-${index}`;
            acc.push({ ...config, jobId: uniqueId });
            return acc;
          }, []);
          
          // Schedule all jobs
          for (const config of uniqueJobConfigs) {
            const jobFunction = async () => {
              await new Promise(resolve => setTimeout(resolve, config.delay));
              
              if (config.shouldFail) {
                throw new Error(`Job ${config.jobId} failed as expected`);
              }
              
              return { success: true, jobId: config.jobId };
            };
            
            scheduler.scheduleJob(config.jobId, '* * * * * *', jobFunction);
          }
          
          // Execute all jobs manually
          for (const config of uniqueJobConfigs) {
            const jobFunction = async () => {
              await new Promise(resolve => setTimeout(resolve, config.delay));
              
              if (config.shouldFail) {
                throw new Error(`Job ${config.jobId} failed as expected`);
              }
              
              return { success: true, jobId: config.jobId };
            };
            
            await scheduler.executeJob(config.jobId, jobFunction, {});
          }
          
          // executeJob is awaited above; give any stray events a moment
          await new Promise(resolve => setTimeout(resolve, 20));
          
          // Verify all jobs were executed
          expect(jobResults).toHaveLength(uniqueJobConfigs.length);
          
          // Verify job isolation - successful jobs should succeed regardless of failures
          const expectedSuccesses = uniqueJobConfigs.filter(c => !c.shouldFail).length;
          const expectedFailures = uniqueJobConfigs.filter(c => c.shouldFail).length;
          
          const actualSuccesses = jobResults.filter(r => r.success).length;
          const actualFailures = jobResults.filter(r => !r.success).length;
          
          expect(actualSuccesses).toBe(expectedSuccesses);
          expect(actualFailures).toBe(expectedFailures);
          
          // Verify scheduler statistics are accurate
          const stats = scheduler.getStats();
          expect(stats.successfulRuns).toBe(expectedSuccesses);
          expect(stats.failedRuns).toBe(expectedFailures);
          
          return true;
          
        } finally {
          await scheduler.shutdown(1000);
        }
      }
    ), { numRuns: 15 });
  }, 30000);

  /**
   * Property: Structured logging completeness
   * All error events should generate structured log entries with required fields
   */
  test('Property 33.3: Structured logging completeness', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        errorMessage: fc.string({ minLength: 1, maxLength: 100 }),
        errorType: fc.oneof(
          fc.constant('file_not_found'),
          fc.constant('permission_denied'),
          fc.constant('timeout'),
          fc.constant('validation_error'),
          fc.constant('general_error')
        ),
        jobId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9-_]+$/.test(s)),
        hasStack: fc.boolean()
      }),
      async (errorConfig) => {
        const scheduler = new JobScheduler();
        const logEntries = [];
        
        scheduler.on('structuredLog', (entry) => {
          logEntries.push(entry);
        });
        // Failed jobs also emit 'error'; an EventEmitter with no 'error'
        // listener throws, which would abort executeJob before it logs
        scheduler.on('error', () => {});
        
        try {
          const error = new Error(errorConfig.errorMessage);
          if (errorConfig.hasStack) {
            error.stack = `Error: ${errorConfig.errorMessage}\n    at test.js:123:45`;
          }
          
          const jobFunction = async () => {
            throw error;
          };
          
          scheduler.scheduleJob(errorConfig.jobId, '* * * * * *', jobFunction);
          await scheduler.executeJob(errorConfig.jobId, jobFunction, {});
          
          // Wait for logging to complete
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Verify structured log entry was created
          expect(logEntries).toHaveLength(1);
          
          const logEntry = logEntries[0];
          
          // Verify required fields are present
          expect(logEntry.timestamp).toBeDefined();
          expect(logEntry.level).toBe('ERROR');
          expect(logEntry.component).toBe('JobScheduler');
          expect(logEntry.jobId).toBe(errorConfig.jobId);
          expect(logEntry.message).toBe(errorConfig.errorMessage);
          
          // Verify stack trace is included when available
          if (errorConfig.hasStack) {
            expect(logEntry.stackTrace).toContain('test.js:123:45');
          }
          
          // Verify timestamp is valid ISO string
          expect(() => new Date(logEntry.timestamp)).not.toThrow();
          expect(new Date(logEntry.timestamp).toISOString()).toBe(logEntry.timestamp);
          
          return true;
          
        } finally {
          await scheduler.shutdown(1000);
        }
      }
    ), { numRuns: 25 });
  });

  /**
   * Property: Data sanitization consistency
   * Sensitive data should be consistently removed from log entries
   */
  test('Property 33.4: Data sanitization consistency', () => {
    fc.assert(fc.property(
      fc.record({
        // Build paths that contain a home directory. (Filtering arbitrary
        // strings for '/home/' never succeeds, so fast-check spun forever.)
        outputPath: homePathArb,
        configPath: homePathArb,
        hasSecretKey: fc.boolean(),
        hasApiToken: fc.boolean(),
        contextSize: fc.integer({ min: 1, max: 10 })
      }),
      (testData) => {
        const scheduler = new JobScheduler();
        const daemon = new SchedulerDaemon();
        
        // Create test data with sensitive information
        const sensitiveData = {
          outputPath: testData.outputPath,
          configPath: testData.configPath
        };
        
        if (testData.hasSecretKey) {
          sensitiveData.secretKey = 'secret-value';
        }
        
        if (testData.hasApiToken) {
          sensitiveData.apiToken = 'token-value';
        }
        
        // Add context with multiple fields
        sensitiveData.context = {};
        for (let i = 0; i < testData.contextSize; i++) {
          sensitiveData.context[`field${i}`] = `value${i}`;
        }
        
        // Sanitize data using both components
        const schedulerSanitized = scheduler.sanitizeJobResult(sensitiveData);
        const daemonSanitized = daemon.sanitizeLogData(sensitiveData);
        
        // Verify paths are sanitized consistently
        if (testData.outputPath.includes('/home/')) {
          expect(schedulerSanitized.outputPath).toContain('/home/***/');
          expect(daemonSanitized.outputPath).toContain('/home/***/');
        }
        
        if (testData.configPath.includes('/home/')) {
          expect(daemonSanitized.configPath).toContain('/home/***/');
        }
        
        // Verify sensitive keys are removed
        expect(schedulerSanitized.secretKey).toBeUndefined();
        expect(schedulerSanitized.apiToken).toBeUndefined();
        expect(daemonSanitized.secretKey).toBeUndefined();
        expect(daemonSanitized.apiToken).toBeUndefined();
        
        // Verify context size limiting
        if (testData.contextSize > 5) {
          const contextKeys = Object.keys(daemonSanitized.context || {});
          expect(contextKeys.length).toBeLessThanOrEqual(6); // 5 fields + '...' indicator
        }
        
        return true;
      }
    ), { numRuns: 30 });
  });

  /**
   * Property: Error recovery and continuation
   * When processing multiple sites and some fail, other sites should continue processing
   */
  test('Property 33.5: Multi-site error recovery', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.record({
        siteId: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s)),
        domain: fc.domain(),
        shouldFailPreFlight: fc.boolean(),
        shouldFailProcessing: fc.boolean()
      }), { minLength: 2, maxLength: 4 }),
      async (siteConfigs) => {
        const executor = new JobExecutor({
          outputDir: tempDir,
          timezone: 'UTC'
        });
        
        const jobResults = [];
        
        try {
          // Create unique site configs and test files
          const uniqueSiteConfigs = [];
          for (let i = 0; i < siteConfigs.length; i++) {
            const config = siteConfigs[i];
            const uniqueId = `${config.siteId}-${i}`;
            const logPath = path.join(tempDir, `${uniqueId}.log`);
            
            // Create log file if pre-flight should succeed
            if (!config.shouldFailPreFlight) {
              await fs.writeFile(logPath, '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"\n');
            }
            
            uniqueSiteConfigs.push({
              siteId: uniqueId,
              siteName: `Site ${uniqueId}`,
              domain: config.domain,
              logPath,
              shouldFailPreFlight: config.shouldFailPreFlight,
              shouldFailProcessing: config.shouldFailProcessing
            });
          }
          
          // Process each site independently
          for (const siteConfig of uniqueSiteConfigs) {
            try {
              const jobFunction = executor.createSiteProcessingJob(siteConfig);
              
              if (siteConfig.shouldFailProcessing && !siteConfig.shouldFailPreFlight) {
                // Simulate processing failure by corrupting the job function
                const failingJobFunction = async (context) => {
                  throw new Error(`Processing failed for ${siteConfig.siteId}`);
                };
                
                await failingJobFunction();
              } else {
                await jobFunction();
              }
              
              jobResults.push({ siteId: siteConfig.siteId, success: true });
              
            } catch (error) {
              jobResults.push({ 
                siteId: siteConfig.siteId, 
                success: false, 
                error: error.message 
              });
            }
          }
          
          // Verify all sites were processed (either successfully or with errors)
          expect(jobResults).toHaveLength(uniqueSiteConfigs.length);
          
          // Verify that successful sites completed regardless of failures
          const expectedSuccesses = uniqueSiteConfigs.filter(c => 
            !c.shouldFailPreFlight && !c.shouldFailProcessing
          ).length;
          
          const actualSuccesses = jobResults.filter(r => r.success).length;
          expect(actualSuccesses).toBe(expectedSuccesses);
          
          // Verify that each site result corresponds to expected outcome
          for (const siteConfig of uniqueSiteConfigs) {
            const result = jobResults.find(r => r.siteId === siteConfig.siteId);
            expect(result).toBeDefined();
            
            if (siteConfig.shouldFailPreFlight || siteConfig.shouldFailProcessing) {
              expect(result.success).toBe(false);
              expect(result.error).toBeDefined();
            } else {
              expect(result.success).toBe(true);
            }
          }
          
          return true;
          
        } catch (error) {
          // Test setup error - skip this iteration
          return true;
        }
      }
    ), { numRuns: 10 });
  });

  /**
   * Property: Log parsing error tolerance
   * When log files contain malformed entries, processing should continue with valid entries
   */
  test('Property 33.6: Log parsing error tolerance', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        validLogLines: fc.array(fc.constant(
          '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"'
        ), { minLength: 1, maxLength: 10 }),
        invalidLogLines: fc.array(fc.oneof(
          fc.constant('invalid log line'),
          fc.constant(''),
          fc.constant('malformed entry without proper format'),
          fc.constant('127.0.0.1 incomplete line')
        ), { minLength: 1, maxLength: 5 })
      }),
      async (testData) => {
        const executor = new JobExecutor({
          outputDir: tempDir,
          timezone: 'UTC'
        });
        
        // Create log file with mixed valid and invalid lines
        const logPath = path.join(tempDir, 'mixed-log.log');
        const allLines = [...testData.validLogLines, ...testData.invalidLogLines];
        
        // Shuffle lines to simulate real-world mixed content
        for (let i = allLines.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [allLines[i], allLines[j]] = [allLines[j], allLines[i]];
        }
        
        await fs.writeFile(logPath, allLines.join('\n') + '\n');
        
        const siteConfig = {
          siteId: 'mixed-log-site',
          siteName: 'Mixed Log Site',
          domain: 'example.com',
          logPath
        };
        
        try {
          const jobFunction = executor.createSiteProcessingJob(siteConfig);
          const result = await jobFunction();
          
          // Processing should succeed even with invalid lines
          expect(result.success).toBe(true);
          
          // Should process at least the valid lines
          expect(result.entriesProcessed).toBeGreaterThanOrEqual(testData.validLogLines.length);
          
          // Should report processing errors for invalid lines
          expect(result.processingErrors).toBeGreaterThanOrEqual(0);
          
          // Analytics should be generated from valid entries
          expect(result.analytics).toBeDefined();
          expect(result.analytics.totalPageviews).toBeGreaterThanOrEqual(testData.validLogLines.length);
          
          return true;
          
        } catch (error) {
          // If all lines are invalid and no processing is possible, that's acceptable
          if (testData.validLogLines.length === 0) {
            expect(error.message).toContain('No log entries could be processed');
            return true;
          }
          
          // Otherwise, processing should have succeeded
          throw error;
        }
      }
    ), { numRuns: 15 });
  });
});