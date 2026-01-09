/**
 * @fileoverview Job scheduling system for automated analytics processing
 * Feature: metrona-analytics-system, Requirements 2.1, 2.2, 3.2
 */

const cron = require('node-cron');
const { EventEmitter } = require('events');

/**
 * Job scheduling system using node-cron for automated analytics processing
 */
class JobScheduler extends EventEmitter {
  /**
   * @param {Object} [options] - Configuration options
   * @param {string} [options.timezone='UTC'] - Timezone for cron jobs
   * @param {boolean} [options.scheduled=true] - Whether jobs are scheduled by default
   */
  constructor(options = {}) {
    super();
    
    this.timezone = options.timezone || 'UTC';
    this.scheduled = options.scheduled !== false;
    
    // Track active jobs
    this.jobs = new Map(); // jobId -> { task, schedule, enabled, lastRun, nextRun }
    this.runningJobs = new Set(); // Set of currently executing job IDs
    
    // Job execution statistics
    this.stats = {
      totalJobs: 0,
      successfulRuns: 0,
      failedRuns: 0,
      lastError: null,
      startTime: new Date()
    };
    
    // Graceful shutdown handling
    this.isShuttingDown = false;
    this.shutdownPromise = null;
  }

  /**
   * Schedule a new job with cron expression
   * @param {string} jobId - Unique identifier for the job
   * @param {string} cronExpression - Cron expression (e.g., '0 0 * * *' for daily at midnight)
   * @param {Function} jobFunction - Function to execute when job runs
   * @param {Object} [options] - Job options
   * @param {boolean} [options.enabled=true] - Whether job is enabled
   * @param {string} [options.description] - Human-readable job description
   * @param {Object} [options.context] - Context data passed to job function
   * @returns {boolean} True if job was scheduled successfully
   */
  scheduleJob(jobId, cronExpression, jobFunction, options = {}) {
    try {
      // Validate inputs
      if (!jobId || typeof jobId !== 'string') {
        throw new Error('Job ID must be a non-empty string');
      }
      
      if (!cronExpression || typeof cronExpression !== 'string') {
        throw new Error('Cron expression must be a non-empty string');
      }
      
      if (typeof jobFunction !== 'function') {
        throw new Error('Job function must be a function');
      }
      
      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        throw new Error(`Invalid cron expression: ${cronExpression}`);
      }
      
      // Check if job already exists
      if (this.jobs.has(jobId)) {
        throw new Error(`Job with ID '${jobId}' already exists`);
      }
      
      const enabled = options.enabled !== false;
      const description = options.description || `Job ${jobId}`;
      const context = options.context || {};
      
      // Create cron task
      const task = cron.schedule(cronExpression, async () => {
        await this.executeJob(jobId, jobFunction, context);
      }, {
        scheduled: this.scheduled && enabled,
        timezone: this.timezone
      });
      
      // Store job metadata
      const jobData = {
        task,
        cronExpression,
        jobFunction,
        enabled,
        description,
        context,
        createdAt: new Date(),
        lastRun: null,
        nextRun: this.getNextRunTime(cronExpression),
        runCount: 0,
        successCount: 0,
        errorCount: 0,
        lastError: null
      };
      
      this.jobs.set(jobId, jobData);
      this.stats.totalJobs++;
      
      this.emit('jobScheduled', { jobId, cronExpression, description, enabled });
      
      return true;
      
    } catch (error) {
      this.emit('error', { type: 'scheduleError', jobId, error: error.message });
      return false;
    }
  }

  /**
   * Execute a job with error handling and statistics tracking
   * @param {string} jobId - Job identifier
   * @param {Function} jobFunction - Function to execute
   * @param {Object} context - Context data for the job
   * @returns {Promise<void>}
   * @private
   */
  async executeJob(jobId, jobFunction, context) {
    // Skip if already running or shutting down
    if (this.runningJobs.has(jobId) || this.isShuttingDown) {
      return;
    }
    
    const jobData = this.jobs.get(jobId);
    if (!jobData || !jobData.enabled) {
      return;
    }
    
    this.runningJobs.add(jobId);
    const startTime = new Date();
    
    try {
      this.emit('jobStarted', { jobId, startTime });
      
      // Execute the job function
      await jobFunction(context);
      
      // Update success statistics
      const endTime = new Date();
      const duration = endTime - startTime;
      
      jobData.lastRun = endTime;
      jobData.nextRun = this.getNextRunTime(jobData.cronExpression);
      jobData.runCount++;
      jobData.successCount++;
      jobData.lastError = null;
      
      this.stats.successfulRuns++;
      
      this.emit('jobCompleted', { 
        jobId, 
        startTime, 
        endTime, 
        duration,
        success: true 
      });
      
    } catch (error) {
      // Update error statistics
      const endTime = new Date();
      const duration = endTime - startTime;
      
      jobData.lastRun = endTime;
      jobData.nextRun = this.getNextRunTime(jobData.cronExpression);
      jobData.runCount++;
      jobData.errorCount++;
      jobData.lastError = {
        message: error.message,
        stack: error.stack,
        timestamp: endTime
      };
      
      this.stats.failedRuns++;
      this.stats.lastError = {
        jobId,
        message: error.message,
        timestamp: endTime
      };
      
      this.emit('jobCompleted', { 
        jobId, 
        startTime, 
        endTime, 
        duration,
        success: false,
        error: error.message 
      });
      
      this.emit('error', { 
        type: 'jobExecutionError', 
        jobId, 
        error: error.message,
        stack: error.stack 
      });
      
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  /**
   * Remove a scheduled job
   * @param {string} jobId - Job identifier
   * @returns {boolean} True if job was removed successfully
   */
  removeJob(jobId) {
    const jobData = this.jobs.get(jobId);
    if (!jobData) {
      return false;
    }
    
    // Stop the cron task
    jobData.task.stop();
    
    // Remove from tracking
    this.jobs.delete(jobId);
    this.runningJobs.delete(jobId);
    this.stats.totalJobs--;
    
    this.emit('jobRemoved', { jobId });
    
    return true;
  }

  /**
   * Enable or disable a job
   * @param {string} jobId - Job identifier
   * @param {boolean} enabled - Whether job should be enabled
   * @returns {boolean} True if job status was changed successfully
   */
  setJobEnabled(jobId, enabled) {
    const jobData = this.jobs.get(jobId);
    if (!jobData) {
      return false;
    }
    
    if (jobData.enabled === enabled) {
      return true; // No change needed
    }
    
    jobData.enabled = enabled;
    
    if (enabled) {
      jobData.task.start();
      jobData.nextRun = this.getNextRunTime(jobData.cronExpression);
    } else {
      jobData.task.stop();
      jobData.nextRun = null;
    }
    
    this.emit('jobStatusChanged', { jobId, enabled });
    
    return true;
  }

  /**
   * Get information about a specific job
   * @param {string} jobId - Job identifier
   * @returns {Object|null} Job information or null if not found
   */
  getJobInfo(jobId) {
    const jobData = this.jobs.get(jobId);
    if (!jobData) {
      return null;
    }
    
    return {
      jobId,
      cronExpression: jobData.cronExpression,
      description: jobData.description,
      enabled: jobData.enabled,
      createdAt: jobData.createdAt,
      lastRun: jobData.lastRun,
      nextRun: jobData.nextRun,
      runCount: jobData.runCount,
      successCount: jobData.successCount,
      errorCount: jobData.errorCount,
      lastError: jobData.lastError,
      isRunning: this.runningJobs.has(jobId)
    };
  }

  /**
   * Get information about all jobs
   * @returns {Array<Object>} Array of job information objects
   */
  getAllJobs() {
    return Array.from(this.jobs.keys()).map(jobId => this.getJobInfo(jobId));
  }

  /**
   * Get scheduler statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      totalJobs: this.jobs.size,
      runningJobs: this.runningJobs.size,
      uptime: new Date() - this.stats.startTime
    };
  }

  /**
   * Start all enabled jobs
   * @returns {void}
   */
  start() {
    if (this.isShuttingDown) {
      return;
    }
    
    for (const [jobId, jobData] of this.jobs) {
      if (jobData.enabled) {
        jobData.task.start();
        jobData.nextRun = this.getNextRunTime(jobData.cronExpression);
      }
    }
    
    this.emit('schedulerStarted');
  }

  /**
   * Stop all jobs
   * @returns {void}
   */
  stop() {
    for (const [jobId, jobData] of this.jobs) {
      jobData.task.stop();
      jobData.nextRun = null;
    }
    
    this.emit('schedulerStopped');
  }

  /**
   * Gracefully shutdown the scheduler, waiting for running jobs to complete
   * @param {number} [timeout=30000] - Maximum time to wait for jobs to complete (ms)
   * @returns {Promise<void>}
   */
  async shutdown(timeout = 30000) {
    if (this.isShuttingDown) {
      return this.shutdownPromise;
    }
    
    this.isShuttingDown = true;
    this.emit('shutdownStarted');
    
    // Stop scheduling new jobs
    this.stop();
    
    // Wait for running jobs to complete
    this.shutdownPromise = new Promise((resolve) => {
      const checkRunningJobs = () => {
        if (this.runningJobs.size === 0) {
          this.emit('shutdownCompleted');
          resolve();
          return;
        }
        
        // Check again in 100ms
        setTimeout(checkRunningJobs, 100);
      };
      
      // Start checking immediately
      checkRunningJobs();
      
      // Force shutdown after timeout
      setTimeout(() => {
        if (this.runningJobs.size > 0) {
          this.emit('shutdownForced', { 
            runningJobs: Array.from(this.runningJobs) 
          });
        }
        resolve();
      }, timeout);
    });
    
    return this.shutdownPromise;
  }

  /**
   * Calculate next run time for a cron expression
   * @param {string} cronExpression - Cron expression
   * @returns {Date|null} Next run time or null if invalid
   * @private
   */
  getNextRunTime(cronExpression) {
    try {
      // Create a temporary task to get next execution time
      const tempTask = cron.schedule(cronExpression, () => {}, {
        scheduled: false,
        timezone: this.timezone
      });
      
      // Get next execution time (this is a simplified approach)
      // In a real implementation, you might use a more sophisticated cron parser
      const now = new Date();
      const nextMinute = new Date(now.getTime() + 60000);
      
      // For now, return next minute as placeholder
      // TODO: Implement proper cron expression parsing for accurate next run time
      return nextMinute;
      
    } catch (error) {
      return null;
    }
  }

  /**
   * Create common cron expressions
   * @returns {Object} Object with common cron expressions
   * @static
   */
  static getCronExpressions() {
    return {
      // Every minute (for testing)
      everyMinute: '* * * * *',
      
      // Hourly
      hourly: '0 * * * *',
      everyTwoHours: '0 */2 * * *',
      everyFourHours: '0 */4 * * *',
      everySixHours: '0 */6 * * *',
      everyTwelveHours: '0 */12 * * *',
      
      // Daily
      daily: '0 0 * * *',
      dailyAt6AM: '0 6 * * *',
      dailyAt9AM: '0 9 * * *',
      dailyAtNoon: '0 12 * * *',
      dailyAt6PM: '0 18 * * *',
      dailyAtMidnight: '0 0 * * *',
      
      // Weekly
      weekly: '0 0 * * 0',
      weeklyMonday: '0 0 * * 1',
      weeklyFriday: '0 0 * * 5',
      
      // Monthly
      monthly: '0 0 1 * *'
      // Note: monthlyLast removed as 'L' is not supported by node-cron
    };
  }

  /**
   * Validate a cron expression
   * @param {string} cronExpression - Cron expression to validate
   * @returns {boolean} True if valid
   * @static
   */
  static validateCronExpression(cronExpression) {
    return cron.validate(cronExpression);
  }
}

module.exports = {
  JobScheduler
};