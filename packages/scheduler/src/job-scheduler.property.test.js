/**
 * @fileoverview Property-based tests for job scheduling consistency
 * Feature: metrona-analytics-system
 * Property 7: Job Scheduling Consistency - validates Requirements 2.1
 */

const fc = require('fast-check');
const { JobScheduler } = require('./job-scheduler');

describe('Property 7: Job Scheduling Consistency', () => {
  let scheduler;
  let testCounter = 0;
  
  beforeEach(() => {
    scheduler = new JobScheduler({ scheduled: false }); // Don't auto-start jobs in tests
    testCounter = 0;
    
    // Handle error events to prevent unhandled error exceptions
    scheduler.on('error', () => {
      // Silently handle errors in tests - we're testing error conditions
    });
  });
  
  afterEach(async () => {
    if (scheduler) {
      // Remove all event listeners
      scheduler.removeAllListeners();
      await scheduler.shutdown(1000);
    }
  });
  
  // Helper function to generate unique job IDs
  const getUniqueJobId = (baseId) => {
    return `${baseId}-${testCounter++}-${Date.now()}`;
  };

  /**
   * Property 7.1: Job Registration Consistency
   * Validates: Requirement 2.1.1 - System reads configuration and sets up parsing jobs
   */
  test('Property 7.1: Job registration should be consistent and deterministic', () => {
    fc.assert(fc.property(
      fc.record({
        jobIdBase: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
        cronExpression: fc.constantFrom(
          '0 0 * * *',    // daily
          '0 * * * *',    // hourly
          '*/5 * * * *',  // every 5 minutes
          '0 0 * * 0',    // weekly
          '0 0 1 * *'     // monthly
        ),
        description: fc.string({ minLength: 1, maxLength: 100 }),
        enabled: fc.boolean()
      }),
      (jobData) => {
        const jobId = getUniqueJobId(jobData.jobIdBase);
        const mockJobFunction = jest.fn();
        
        // Schedule the job
        const result = scheduler.scheduleJob(
          jobId,
          jobData.cronExpression,
          mockJobFunction,
          {
            description: jobData.description,
            enabled: jobData.enabled
          }
        );
        
        // Job should be scheduled successfully
        expect(result).toBe(true);
        
        // Job should be retrievable with consistent data
        const jobInfo = scheduler.getJobInfo(jobId);
        expect(jobInfo).not.toBeNull();
        expect(jobInfo.jobId).toBe(jobId);
        expect(jobInfo.cronExpression).toBe(jobData.cronExpression);
        expect(jobInfo.description).toBe(jobData.description);
        expect(jobInfo.enabled).toBe(jobData.enabled);
        expect(jobInfo.runCount).toBe(0);
        expect(jobInfo.successCount).toBe(0);
        expect(jobInfo.errorCount).toBe(0);
        expect(jobInfo.isRunning).toBe(false);
        
        // Job should appear in getAllJobs()
        const allJobs = scheduler.getAllJobs();
        const foundJob = allJobs.find(job => job.jobId === jobId);
        expect(foundJob).toBeDefined();
        expect(foundJob).toEqual(jobInfo);
        
        // Scheduler stats should reflect the new job
        const stats = scheduler.getStats();
        expect(stats.totalJobs).toBeGreaterThan(0);
      }
    ), { numRuns: 100 });
  });

  /**
   * Property 7.2: Cron Expression Validation Consistency
   * Validates: Requirement 2.1.1 - System validates cron expressions properly
   */
  test('Property 7.2: Cron expression validation should be consistent', () => {
    fc.assert(fc.property(
      fc.record({
        validExpressions: fc.constantFrom(
          '0 0 * * *',      // daily at midnight
          '0 * * * *',      // every hour
          '*/15 * * * *',   // every 15 minutes
          '0 9 * * 1-5',    // weekdays at 9am
          '0 0 1 * *',      // monthly
          '30 2 * * 0'      // weekly on Sunday at 2:30am
        ),
        invalidExpressions: fc.constantFrom(
          '60 0 * * *',     // invalid minute
          '0 25 * * *',     // invalid hour
          '0 0 32 * *',     // invalid day
          '0 0 * 13 *',     // invalid month
          '0 0 * * 8',      // invalid day of week
          'invalid',        // not a cron expression
          '',               // empty string
          '* * * *'         // missing field
        )
      }),
      (expressions) => {
        const mockJobFunction = jest.fn();
        const validJobId = getUniqueJobId('test-valid');
        const invalidJobId = getUniqueJobId('test-invalid');
        
        // Valid expressions should be accepted
        const validResult = scheduler.scheduleJob(
          validJobId,
          expressions.validExpressions,
          mockJobFunction
        );
        expect(validResult).toBe(true);
        
        // Invalid expressions should be rejected
        const invalidResult = scheduler.scheduleJob(
          invalidJobId,
          expressions.invalidExpressions,
          mockJobFunction
        );
        expect(invalidResult).toBe(false);
        
        // Static validation should match scheduling behavior
        expect(JobScheduler.validateCronExpression(expressions.validExpressions)).toBe(true);
        expect(JobScheduler.validateCronExpression(expressions.invalidExpressions)).toBe(false);
      }
    ), { numRuns: 100 });
  });

  /**
   * Property 7.3: Job State Management Consistency
   * Validates: Requirement 2.1.1 - Jobs maintain consistent state throughout lifecycle
   */
  test('Property 7.3: Job state management should be consistent', () => {
    fc.assert(fc.property(
      fc.record({
        jobIdBase: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
        initialEnabled: fc.boolean(),
        toggleSequence: fc.array(fc.boolean(), { minLength: 1, maxLength: 5 })
      }),
      (testData) => {
        const jobId = getUniqueJobId(testData.jobIdBase);
        const mockJobFunction = jest.fn();
        
        // Schedule job with initial state
        const scheduleResult = scheduler.scheduleJob(
          jobId,
          '0 0 * * *',
          mockJobFunction,
          { enabled: testData.initialEnabled }
        );
        expect(scheduleResult).toBe(true);
        
        // Verify initial state
        let jobInfo = scheduler.getJobInfo(jobId);
        expect(jobInfo.enabled).toBe(testData.initialEnabled);
        
        // Apply toggle sequence and verify state consistency
        for (const enabled of testData.toggleSequence) {
          const toggleResult = scheduler.setJobEnabled(jobId, enabled);
          expect(toggleResult).toBe(true);
          
          jobInfo = scheduler.getJobInfo(jobId);
          expect(jobInfo.enabled).toBe(enabled);
          
          // State should be consistent across getAllJobs()
          const allJobs = scheduler.getAllJobs();
          const foundJob = allJobs.find(job => job.jobId === jobId);
          expect(foundJob.enabled).toBe(enabled);
        }
        
        // Job removal should be consistent
        const removeResult = scheduler.removeJob(jobId);
        expect(removeResult).toBe(true);
        
        // Job should no longer exist
        expect(scheduler.getJobInfo(jobId)).toBeNull();
        
        // Job should not appear in getAllJobs()
        const finalJobs = scheduler.getAllJobs();
        const removedJob = finalJobs.find(job => job.jobId === jobId);
        expect(removedJob).toBeUndefined();
      }
    ), { numRuns: 100 });
  });

  /**
   * Property 7.4: Job Execution Statistics Consistency
   * Validates: Requirement 2.1.2 - System tracks job execution properly
   */
  test('Property 7.4: Job execution statistics should be consistent', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        jobIdBase: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
        successCount: fc.integer({ min: 0, max: 5 }),
        errorCount: fc.integer({ min: 0, max: 3 })
      }),
      async (testData) => {
        const jobId = getUniqueJobId(testData.jobIdBase);
        let executionCount = 0;
        
        // Create job function that succeeds/fails based on execution count
        const mockJobFunction = jest.fn().mockImplementation(async () => {
          executionCount++;
          if (executionCount <= testData.successCount) {
            return `Success ${executionCount}`;
          } else {
            throw new Error(`Simulated error ${executionCount}`);
          }
        });
        
        // Schedule the job
        scheduler.scheduleJob(jobId, '0 0 * * *', mockJobFunction);
        
        // Execute job multiple times manually
        const totalExecutions = testData.successCount + testData.errorCount;
        for (let i = 0; i < totalExecutions; i++) {
          await scheduler.executeJob(jobId, mockJobFunction, {});
        }
        
        // Verify statistics consistency
        const jobInfo = scheduler.getJobInfo(jobId);
        expect(jobInfo.runCount).toBe(totalExecutions);
        expect(jobInfo.successCount).toBe(testData.successCount);
        expect(jobInfo.errorCount).toBe(testData.errorCount);
        
        // Global stats should reflect job executions
        const globalStats = scheduler.getStats();
        expect(globalStats.successfulRuns).toBeGreaterThanOrEqual(testData.successCount);
        expect(globalStats.failedRuns).toBeGreaterThanOrEqual(testData.errorCount);
        
        // Error information should be consistent
        if (testData.errorCount > 0) {
          expect(jobInfo.lastError).not.toBeNull();
          expect(jobInfo.lastError.message).toContain('Simulated error');
          expect(globalStats.lastError).not.toBeNull();
        }
      }
    ), { numRuns: 50 }); // Reduced runs due to async nature
  });

  /**
   * Property 7.5: Scheduler Lifecycle Consistency
   * Validates: Requirement 2.1 - Scheduler maintains consistent state during start/stop cycles
   */
  test('Property 7.5: Scheduler lifecycle should be consistent', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        jobCount: fc.integer({ min: 1, max: 5 }),
        startStopCycles: fc.integer({ min: 1, max: 3 })
      }),
      async (testData) => {
        // Create a fresh scheduler for this test iteration
        const testScheduler = new JobScheduler({ scheduled: false });
        testScheduler.on('error', () => {}); // Handle errors silently
        
        try {
          // Create multiple jobs
          const jobIds = [];
          for (let i = 0; i < testData.jobCount; i++) {
            const jobId = getUniqueJobId(`test-job-${i}`);
            const mockJobFunction = jest.fn();
            
            testScheduler.scheduleJob(jobId, '0 0 * * *', mockJobFunction);
            jobIds.push(jobId);
          }
          
          // Verify initial state
          expect(testScheduler.getAllJobs()).toHaveLength(testData.jobCount);
          
          // Perform start/stop cycles
          for (let cycle = 0; cycle < testData.startStopCycles; cycle++) {
            // Start scheduler
            testScheduler.start();
            
            // All jobs should still exist
            expect(testScheduler.getAllJobs()).toHaveLength(testData.jobCount);
            
            // Each job should be retrievable
            for (const jobId of jobIds) {
              const jobInfo = testScheduler.getJobInfo(jobId);
              expect(jobInfo).not.toBeNull();
              expect(jobInfo.jobId).toBe(jobId);
            }
            
            // Stop scheduler
            testScheduler.stop();
            
            // Jobs should still exist after stop
            expect(testScheduler.getAllJobs()).toHaveLength(testData.jobCount);
          }
          
          // Final shutdown should be clean
          await testScheduler.shutdown(1000);
          
          // Jobs should still be tracked (shutdown doesn't remove jobs)
          expect(testScheduler.getAllJobs()).toHaveLength(testData.jobCount);
          
        } finally {
          // Ensure cleanup
          testScheduler.removeAllListeners();
          await testScheduler.shutdown(1000);
        }
      }
    ), { numRuns: 30 }); // Reduced runs due to async nature and complexity
  });

  /**
   * Property 7.6: Error Handling Consistency
   * Validates: Requirement 2.1 - System handles errors consistently
   */
  test('Property 7.6: Error handling should be consistent', () => {
    fc.assert(fc.property(
      fc.record({
        invalidInputs: fc.record({
          emptyJobId: fc.constant(''),
          nullJobId: fc.constant(null),
          undefinedJobId: fc.constant(undefined),
          invalidCron: fc.constantFrom('invalid', '60 0 * * *', ''),
          nullFunction: fc.constant(null),
          undefinedFunction: fc.constant(undefined)
        })
      }),
      (testData) => {
        const mockJobFunction = jest.fn();
        const validCron = '0 0 * * *';
        const validJobId = getUniqueJobId('valid-job');
        
        // Invalid job IDs should be rejected consistently
        expect(scheduler.scheduleJob(testData.invalidInputs.emptyJobId, validCron, mockJobFunction)).toBe(false);
        expect(scheduler.scheduleJob(testData.invalidInputs.nullJobId, validCron, mockJobFunction)).toBe(false);
        expect(scheduler.scheduleJob(testData.invalidInputs.undefinedJobId, validCron, mockJobFunction)).toBe(false);
        
        // Invalid cron expressions should be rejected consistently
        expect(scheduler.scheduleJob(getUniqueJobId('test-invalid-cron'), testData.invalidInputs.invalidCron, mockJobFunction)).toBe(false);
        
        // Invalid job functions should be rejected consistently
        expect(scheduler.scheduleJob(getUniqueJobId('test-null-func'), validCron, testData.invalidInputs.nullFunction)).toBe(false);
        expect(scheduler.scheduleJob(getUniqueJobId('test-undef-func'), validCron, testData.invalidInputs.undefinedFunction)).toBe(false);
        
        // Operations on non-existent jobs should be handled consistently
        expect(scheduler.getJobInfo('non-existent-job')).toBeNull();
        expect(scheduler.removeJob('non-existent-job')).toBe(false);
        expect(scheduler.setJobEnabled('non-existent-job', true)).toBe(false);
        
        // Duplicate job IDs should be rejected consistently
        expect(scheduler.scheduleJob(validJobId, validCron, mockJobFunction)).toBe(true);
        expect(scheduler.scheduleJob(validJobId, validCron, mockJobFunction)).toBe(false); // Duplicate
      }
    ), { numRuns: 100 });
  });

  /**
   * Property 7.7: Common Cron Expression Consistency
   * Validates: Requirement 2.1 - System provides consistent cron expression utilities
   */
  test('Property 7.7: Common cron expressions should be valid and consistent', () => {
    fc.assert(fc.property(
      fc.constant(true), // Dummy property to run the test
      () => {
        const commonExpressions = JobScheduler.getCronExpressions();
        
        // All common expressions should be valid
        for (const [name, expression] of Object.entries(commonExpressions)) {
          expect(JobScheduler.validateCronExpression(expression)).toBe(true);
          
          // Should be able to schedule jobs with common expressions
          const jobId = getUniqueJobId(`test-${name}`);
          const mockJobFunction = jest.fn();
          const result = scheduler.scheduleJob(jobId, expression, mockJobFunction);
          expect(result).toBe(true);
          
          // Job should be retrievable with correct cron expression
          const jobInfo = scheduler.getJobInfo(jobId);
          expect(jobInfo.cronExpression).toBe(expression);
        }
        
        // Verify specific common expressions exist
        expect(commonExpressions.daily).toBeDefined();
        expect(commonExpressions.hourly).toBeDefined();
        expect(commonExpressions.weekly).toBeDefined();
        expect(commonExpressions.monthly).toBeDefined();
        
        // Daily should be midnight
        expect(commonExpressions.daily).toBe('0 0 * * *');
        
        // Hourly should be top of every hour
        expect(commonExpressions.hourly).toBe('0 * * * *');
      }
    ), { numRuns: 10 }); // Low runs since this tests static data
  });
});