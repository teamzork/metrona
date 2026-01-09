/**
 * @fileoverview Unit tests for JobScheduler
 * Feature: metrona-analytics-system
 */

const { JobScheduler } = require('./job-scheduler');

describe('JobScheduler', () => {
  let scheduler;

  beforeEach(() => {
    scheduler = new JobScheduler({ scheduled: false }); // Don't auto-start jobs in tests
    
    // Handle error events to prevent unhandled error warnings
    scheduler.on('error', () => {
      // Ignore errors in tests - they're expected for negative test cases
    });
  });

  afterEach(async () => {
    if (scheduler) {
      await scheduler.shutdown(1000);
    }
  });

  describe('constructor', () => {
    it('should create scheduler with default options', () => {
      const defaultScheduler = new JobScheduler();
      
      expect(defaultScheduler.timezone).toBe('UTC');
      expect(defaultScheduler.scheduled).toBe(true);
      expect(defaultScheduler.jobs.size).toBe(0);
      expect(defaultScheduler.runningJobs.size).toBe(0);
    });

    it('should create scheduler with custom options', () => {
      const customScheduler = new JobScheduler({
        timezone: 'America/New_York',
        scheduled: false
      });
      
      expect(customScheduler.timezone).toBe('America/New_York');
      expect(customScheduler.scheduled).toBe(false);
    });
  });

  describe('scheduleJob', () => {
    it('should schedule a valid job successfully', () => {
      const jobFunction = jest.fn();
      const result = scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction, {
        description: 'Test job'
      });
      
      expect(result).toBe(true);
      expect(scheduler.jobs.has('test-job')).toBe(true);
      
      const jobInfo = scheduler.getJobInfo('test-job');
      expect(jobInfo.jobId).toBe('test-job');
      expect(jobInfo.cronExpression).toBe('0 0 * * *');
      expect(jobInfo.description).toBe('Test job');
      expect(jobInfo.enabled).toBe(true);
    });

    it('should reject invalid job ID', () => {
      const jobFunction = jest.fn();
      const result = scheduler.scheduleJob('', '0 0 * * *', jobFunction);
      
      expect(result).toBe(false);
      expect(scheduler.jobs.size).toBe(0);
    });

    it('should reject invalid cron expression', () => {
      const jobFunction = jest.fn();
      const result = scheduler.scheduleJob('test-job', 'invalid-cron', jobFunction);
      
      expect(result).toBe(false);
      expect(scheduler.jobs.size).toBe(0);
    });

    it('should reject non-function job function', () => {
      const result = scheduler.scheduleJob('test-job', '0 0 * * *', 'not-a-function');
      
      expect(result).toBe(false);
      expect(scheduler.jobs.size).toBe(0);
    });

    it('should reject duplicate job IDs', () => {
      const jobFunction = jest.fn();
      
      const result1 = scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction);
      const result2 = scheduler.scheduleJob('test-job', '0 1 * * *', jobFunction);
      
      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(scheduler.jobs.size).toBe(1);
    });

    it('should schedule disabled job', () => {
      const jobFunction = jest.fn();
      const result = scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction, {
        enabled: false
      });
      
      expect(result).toBe(true);
      
      const jobInfo = scheduler.getJobInfo('test-job');
      expect(jobInfo.enabled).toBe(false);
    });

    it('should emit jobScheduled event', (done) => {
      const jobFunction = jest.fn();
      
      scheduler.on('jobScheduled', (data) => {
        expect(data.jobId).toBe('test-job');
        expect(data.cronExpression).toBe('0 0 * * *');
        expect(data.description).toBe('Test job');
        expect(data.enabled).toBe(true);
        done();
      });
      
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction, {
        description: 'Test job'
      });
    });
  });

  describe('removeJob', () => {
    beforeEach(() => {
      const jobFunction = jest.fn();
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction);
    });

    it('should remove existing job', () => {
      const result = scheduler.removeJob('test-job');
      
      expect(result).toBe(true);
      expect(scheduler.jobs.has('test-job')).toBe(false);
    });

    it('should return false for non-existent job', () => {
      const result = scheduler.removeJob('non-existent');
      
      expect(result).toBe(false);
    });

    it('should emit jobRemoved event', (done) => {
      scheduler.on('jobRemoved', (data) => {
        expect(data.jobId).toBe('test-job');
        done();
      });
      
      scheduler.removeJob('test-job');
    });
  });

  describe('setJobEnabled', () => {
    beforeEach(() => {
      const jobFunction = jest.fn();
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction);
    });

    it('should enable disabled job', () => {
      scheduler.setJobEnabled('test-job', false);
      const result = scheduler.setJobEnabled('test-job', true);
      
      expect(result).toBe(true);
      
      const jobInfo = scheduler.getJobInfo('test-job');
      expect(jobInfo.enabled).toBe(true);
    });

    it('should disable enabled job', () => {
      const result = scheduler.setJobEnabled('test-job', false);
      
      expect(result).toBe(true);
      
      const jobInfo = scheduler.getJobInfo('test-job');
      expect(jobInfo.enabled).toBe(false);
    });

    it('should return false for non-existent job', () => {
      const result = scheduler.setJobEnabled('non-existent', true);
      
      expect(result).toBe(false);
    });

    it('should return true if no change needed', () => {
      const result = scheduler.setJobEnabled('test-job', true); // Already enabled
      
      expect(result).toBe(true);
    });

    it('should emit jobStatusChanged event', (done) => {
      scheduler.on('jobStatusChanged', (data) => {
        expect(data.jobId).toBe('test-job');
        expect(data.enabled).toBe(false);
        done();
      });
      
      scheduler.setJobEnabled('test-job', false);
    });
  });

  describe('getJobInfo', () => {
    it('should return job information for existing job', () => {
      const jobFunction = jest.fn();
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction, {
        description: 'Test job'
      });
      
      const jobInfo = scheduler.getJobInfo('test-job');
      
      expect(jobInfo).toMatchObject({
        jobId: 'test-job',
        cronExpression: '0 0 * * *',
        description: 'Test job',
        enabled: true,
        runCount: 0,
        successCount: 0,
        errorCount: 0,
        isRunning: false
      });
      
      expect(jobInfo.createdAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent job', () => {
      const jobInfo = scheduler.getJobInfo('non-existent');
      
      expect(jobInfo).toBeNull();
    });
  });

  describe('getAllJobs', () => {
    it('should return empty array when no jobs scheduled', () => {
      const jobs = scheduler.getAllJobs();
      
      expect(jobs).toEqual([]);
    });

    it('should return all scheduled jobs', () => {
      const jobFunction = jest.fn();
      scheduler.scheduleJob('job1', '0 0 * * *', jobFunction);
      scheduler.scheduleJob('job2', '0 1 * * *', jobFunction);
      
      const jobs = scheduler.getAllJobs();
      
      expect(jobs).toHaveLength(2);
      expect(jobs.map(job => job.jobId)).toEqual(['job1', 'job2']);
    });
  });

  describe('getStats', () => {
    it('should return initial statistics', () => {
      const stats = scheduler.getStats();
      
      expect(stats).toMatchObject({
        totalJobs: 0,
        successfulRuns: 0,
        failedRuns: 0,
        runningJobs: 0,
        lastError: null
      });
      
      expect(stats.startTime).toBeInstanceOf(Date);
      expect(typeof stats.uptime).toBe('number');
    });

    it('should update statistics after scheduling jobs', () => {
      const jobFunction = jest.fn();
      scheduler.scheduleJob('job1', '0 0 * * *', jobFunction);
      scheduler.scheduleJob('job2', '0 1 * * *', jobFunction);
      
      const stats = scheduler.getStats();
      
      expect(stats.totalJobs).toBe(2);
    });
  });

  describe('start and stop', () => {
    beforeEach(() => {
      const jobFunction = jest.fn();
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction);
    });

    it('should start scheduler and emit event', (done) => {
      scheduler.on('schedulerStarted', () => {
        done();
      });
      
      scheduler.start();
    });

    it('should stop scheduler and emit event', (done) => {
      scheduler.on('schedulerStopped', () => {
        done();
      });
      
      scheduler.stop();
    });
  });

  describe('executeJob', () => {
    it('should execute job successfully and update statistics', async () => {
      const jobFunction = jest.fn().mockResolvedValue('success');
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction);
      
      // Manually execute the job
      await scheduler.executeJob('test-job', jobFunction, {});
      
      const jobInfo = scheduler.getJobInfo('test-job');
      expect(jobInfo.runCount).toBe(1);
      expect(jobInfo.successCount).toBe(1);
      expect(jobInfo.errorCount).toBe(0);
      expect(jobInfo.lastError).toBeNull();
      
      const stats = scheduler.getStats();
      expect(stats.successfulRuns).toBe(1);
      expect(stats.failedRuns).toBe(0);
    });

    it('should handle job execution errors and update statistics', async () => {
      const error = new Error('Job failed');
      const jobFunction = jest.fn().mockRejectedValue(error);
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction);
      
      // Handle the expected error event
      const errorHandler = jest.fn();
      scheduler.on('error', errorHandler);
      
      // Manually execute the job
      await scheduler.executeJob('test-job', jobFunction, {});
      
      const jobInfo = scheduler.getJobInfo('test-job');
      expect(jobInfo.runCount).toBe(1);
      expect(jobInfo.successCount).toBe(0);
      expect(jobInfo.errorCount).toBe(1);
      expect(jobInfo.lastError.message).toBe('Job failed');
      
      const stats = scheduler.getStats();
      expect(stats.successfulRuns).toBe(0);
      expect(stats.failedRuns).toBe(1);
      expect(stats.lastError.message).toBe('Job failed');
      
      // Verify error event was emitted
      expect(errorHandler).toHaveBeenCalledWith({
        type: 'jobExecutionError',
        jobId: 'test-job',
        error: 'Job failed',
        stack: expect.any(String)
      });
    });

    it('should emit jobStarted and jobCompleted events', async () => {
      const jobFunction = jest.fn().mockResolvedValue('success');
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction);
      
      const events = [];
      scheduler.on('jobStarted', (data) => events.push({ type: 'started', data }));
      scheduler.on('jobCompleted', (data) => events.push({ type: 'completed', data }));
      
      await scheduler.executeJob('test-job', jobFunction, {});
      
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('started');
      expect(events[0].data.jobId).toBe('test-job');
      expect(events[1].type).toBe('completed');
      expect(events[1].data.success).toBe(true);
    });

    it('should not execute disabled job', async () => {
      const jobFunction = jest.fn();
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction);
      scheduler.setJobEnabled('test-job', false);
      
      await scheduler.executeJob('test-job', jobFunction, {});
      
      expect(jobFunction).not.toHaveBeenCalled();
    });

    it('should not execute job if already running', async () => {
      const jobFunction = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction);
      
      // Start first execution
      const promise1 = scheduler.executeJob('test-job', jobFunction, {});
      
      // Try to start second execution while first is running
      const promise2 = scheduler.executeJob('test-job', jobFunction, {});
      
      await Promise.all([promise1, promise2]);
      
      // Should only be called once
      expect(jobFunction).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully when no jobs are running', async () => {
      const jobFunction = jest.fn();
      scheduler.scheduleJob('test-job', '0 0 * * *', jobFunction);
      
      const shutdownPromise = scheduler.shutdown(1000);
      
      await expect(shutdownPromise).resolves.toBeUndefined();
      expect(scheduler.isShuttingDown).toBe(true);
    });

    it('should emit shutdown events', async () => {
      const events = [];
      scheduler.on('shutdownStarted', () => events.push('started'));
      scheduler.on('shutdownCompleted', () => events.push('completed'));
      
      await scheduler.shutdown(1000);
      
      expect(events).toEqual(['started', 'completed']);
    });
  });

  describe('static methods', () => {
    describe('getCronExpressions', () => {
      it('should return common cron expressions', () => {
        const expressions = JobScheduler.getCronExpressions();
        
        expect(expressions).toHaveProperty('daily', '0 0 * * *');
        expect(expressions).toHaveProperty('hourly', '0 * * * *');
        expect(expressions).toHaveProperty('weekly', '0 0 * * 0');
        expect(expressions).toHaveProperty('monthly', '0 0 1 * *');
      });
    });

    describe('validateCronExpression', () => {
      it('should validate correct cron expressions', () => {
        expect(JobScheduler.validateCronExpression('0 0 * * *')).toBe(true);
        expect(JobScheduler.validateCronExpression('*/5 * * * *')).toBe(true);
        expect(JobScheduler.validateCronExpression('0 9-17 * * 1-5')).toBe(true);
      });

      it('should reject invalid cron expressions', () => {
        expect(JobScheduler.validateCronExpression('invalid')).toBe(false);
        expect(JobScheduler.validateCronExpression('60 0 * * *')).toBe(false);
        expect(JobScheduler.validateCronExpression('')).toBe(false);
      });
    });
  });
});