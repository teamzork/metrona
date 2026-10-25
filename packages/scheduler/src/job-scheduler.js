/**
 * @fileoverview Job scheduling system for automated analytics processing
 * Feature: metrona-analytics-system, Requirements 2.1, 2.2, 2.5, 3.2, 10.1, 10.2, 10.4
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
    let timeoutHandle;
    
    try {
      this.emit('jobStarted', { jobId, startTime });
      
      // Execute the job function with timeout protection
      const timeoutMs = context.timeout || 300000; // 5 minute default timeout
      const jobPromise = jobFunction(context);
      
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Job execution timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      
      // Race between job completion and timeout
      const result = await Promise.race([jobPromise, timeoutPromise]);
      
      // Update success statistics
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      
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
        success: true,
        result: this.sanitizeJobResult(result)
      });
      
    } catch (error) {
      // Enhanced error handling with detailed logging
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      
      // Categorize error types for better handling
      const errorCategory = this.categorizeError(error);
      const errorDetails = {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        category: errorCategory,
        timestamp: endTime,
        duration,
        context: this.sanitizeContext(context)
      };
      
      jobData.lastRun = endTime;
      jobData.nextRun = this.getNextRunTime(jobData.cronExpression);
      jobData.runCount++;
      jobData.errorCount++;
      jobData.lastError = errorDetails;
      
      this.stats.failedRuns++;
      this.stats.lastError = {
        jobId,
        message: errorDetails.message,
        category: errorCategory,
        timestamp: endTime
      };
      
      // Emit detailed error information for logging
      this.emit('jobCompleted', { 
        jobId, 
        startTime, 
        endTime, 
        duration,
        success: false,
        error: errorDetails.message,
        errorCategory,
        errorDetails
      });
      
      this.emit('error', { 
        type: 'jobExecutionError', 
        jobId, 
        error: errorDetails.message,
        errorCategory,
        stack: errorDetails.stack,
        duration,
        context: errorDetails.context,
        timestamp: endTime
      });
      
      // Log structured error information for troubleshooting (Requirement 2.5)
      this.logStructuredError(jobId, errorDetails);
      
    } finally {
      // Clear the timeout on failure too; otherwise every failed job leaves
      // a live timer (5 minutes by default) that keeps the process running
      clearTimeout(timeoutHandle);
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
      let checkTimer = null;
      let forceTimer = null;
      const finish = () => {
        clearTimeout(checkTimer);
        clearTimeout(forceTimer);
        resolve();
      };
      
      const checkRunningJobs = () => {
        if (this.runningJobs.size === 0) {
          this.emit('shutdownCompleted');
          finish();
          return;
        }
        
        // Check again in 100ms
        checkTimer = setTimeout(checkRunningJobs, 100);
      };
      
      // Force shutdown after timeout
      forceTimer = setTimeout(() => {
        if (this.runningJobs.size > 0) {
          this.emit('shutdownForced', { 
            runningJobs: Array.from(this.runningJobs) 
          });
        }
        finish();
      }, timeout);
      
      // Start checking immediately
      checkRunningJobs();
    });
    
    return this.shutdownPromise;
  }

  /**
   * Categorize errors for better handling and logging
   * @param {Error|any} error - Error to categorize
   * @returns {string} Error category
   * @private
   */
  categorizeError(error) {
    if (!error) return 'unknown';
    
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    
    // File system errors
    if (message.includes('ENOENT') || message.includes('no such file')) {
      return 'file_not_found';
    }
    if (message.includes('EACCES') || message.includes('permission denied')) {
      return 'permission_denied';
    }
    if (message.includes('EMFILE') || message.includes('too many open files')) {
      return 'resource_exhaustion';
    }
    
    // Network/connectivity errors
    if (message.includes('ECONNREFUSED') || message.includes('connection refused')) {
      return 'connection_refused';
    }
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
      return 'timeout';
    }
    
    // Memory/resource errors
    if (message.includes('out of memory') || message.includes('heap out of memory')) {
      return 'memory_exhaustion';
    }
    
    // Parsing/validation errors
    if (message.includes('invalid') || message.includes('malformed') || message.includes('parse')) {
      return 'validation_error';
    }
    
    // Configuration errors
    if (message.includes('configuration') || message.includes('config')) {
      return 'configuration_error';
    }
    
    // Job-specific errors
    if (message.includes('Job execution timeout')) {
      return 'job_timeout';
    }
    
    // Check stack trace for more context
    if (stack.includes('YamlDatasetWriter')) {
      return 'yaml_generation_error';
    }
    if (stack.includes('LogFileReader') || stack.includes('NginxLogParser')) {
      return 'log_processing_error';
    }
    if (stack.includes('AnalyticsCalculator')) {
      return 'analytics_calculation_error';
    }
    
    return 'general_error';
  }

  /**
   * Log structured error information for troubleshooting
   * @param {string} jobId - Job identifier
   * @param {Object} errorDetails - Detailed error information
   * @private
   */
  logStructuredError(jobId, errorDetails) {
    const logEntry = {
      timestamp: errorDetails.timestamp.toISOString(),
      level: 'ERROR',
      component: 'JobScheduler',
      jobId,
      errorCategory: errorDetails.category,
      message: errorDetails.message,
      duration: errorDetails.duration,
      context: errorDetails.context
    };
    
    // Include stack trace for debugging if available
    if (errorDetails.stack) {
      logEntry.stackTrace = errorDetails.stack;
    }
    
    // Emit structured log event for external logging systems
    this.emit('structuredLog', logEntry);
    
    // Also log to console with structured format for immediate visibility
    console.error(`[${logEntry.timestamp}] ${logEntry.level} ${logEntry.component}: Job ${jobId} failed`);
    console.error(`  Category: ${logEntry.errorCategory}`);
    console.error(`  Message: ${logEntry.message}`);
    console.error(`  Duration: ${logEntry.duration}ms`);
    
    if (logEntry.context && Object.keys(logEntry.context).length > 0) {
      console.error(`  Context: ${JSON.stringify(logEntry.context, null, 2)}`);
    }
    
    if (logEntry.stackTrace && process.env.NODE_ENV !== 'production') {
      console.error(`  Stack: ${logEntry.stackTrace}`);
    }
  }

  /**
   * Sanitize job result for logging (remove sensitive data)
   * @param {any} result - Job execution result
   * @returns {any} Sanitized result
   * @private
   */
  sanitizeJobResult(result) {
    if (!result || typeof result !== 'object') {
      return result;
    }
    
    // Create a copy and remove sensitive fields
    const sanitized = { ...result };
    
    // Drop credential-like fields (secrets, tokens, passwords, API keys)
    for (const key of Object.keys(sanitized)) {
      if (/secret|token|passw(or)?d|api[-_]?key|credential/i.test(key)) {
        delete sanitized[key];
      }
    }
    
    // Remove potentially sensitive paths
    if (sanitized.outputPath) {
      sanitized.outputPath = sanitized.outputPath.replace(/\/home\/[^\/]+/, '/home/***');
    }
    
    // Limit analytics data to summary only
    if (sanitized.analytics) {
      sanitized.analytics = {
        totalPageviews: sanitized.analytics.totalPageviews,
        uniqueVisitors: sanitized.analytics.uniqueVisitors,
        totalPages: sanitized.analytics.totalPages
      };
    }
    
    return sanitized;
  }

  /**
   * Sanitize context data for logging (remove sensitive information)
   * @param {Object} context - Context data
   * @returns {Object} Sanitized context
   * @private
   */
  sanitizeContext(context) {
    if (!context || typeof context !== 'object') {
      return {};
    }
    
    const sanitized = {};
    
    // Include safe context fields
    if (context.batchSize) sanitized.batchSize = context.batchSize;
    if (context.timeout) sanitized.timeout = context.timeout;
    
    // Sanitize site config if present
    if (context.siteConfig) {
      sanitized.siteConfig = {
        siteId: context.siteConfig.siteId,
        domain: context.siteConfig.domain,
        // Don't include full log paths for security
        hasLogPath: !!context.siteConfig.logPath
      };
    }
    
    return sanitized;
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