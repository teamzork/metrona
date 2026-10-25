/**
 * @fileoverview Main scheduler daemon for automated analytics processing
 * Feature: metrona-analytics-system, Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 10.1, 10.2, 10.4
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const chokidar = require('chokidar');
const { ConfigurationManager } = require('./config-manager');
const { JobScheduler } = require('./job-scheduler');
const { JobExecutor } = require('./job-executor');

/**
 * Main scheduler daemon that manages automated analytics processing
 */
class SchedulerDaemon extends EventEmitter {
  /**
   * @param {Object} [options] - Configuration options
   * @param {string} [options.configPath='./config/scheduler.yaml'] - Path to configuration file
   * @param {string} [options.outputDir='./analytics'] - Output directory for analytics data
   * @param {string} [options.timezone='UTC'] - Default timezone
   * @param {boolean} [options.watchConfig=true] - Whether to watch config file for changes
   * @param {Object} [options.schedulerOptions] - Options passed to JobScheduler
   * @param {Object} [options.executorOptions] - Options passed to JobExecutor
   */
  constructor(options = {}) {
    super();
    
    this.configPath = options.configPath || './config/scheduler.yaml';
    this.outputDir = options.outputDir || './analytics';
    this.timezone = options.timezone || 'UTC';
    this.watchConfig = options.watchConfig !== false;
    
    // Initialize components
    this.scheduler = new JobScheduler({
      timezone: this.timezone,
      ...options.schedulerOptions
    });
    
    this.executor = new JobExecutor({
      outputDir: this.outputDir,
      timezone: this.timezone,
      ...options.executorOptions
    });
    
    // Configuration state
    this.config = null;
    this.configWatcher = null;
    this.lastConfigLoad = null;
    this.isRunning = false;
    this.isShuttingDown = false;
    
    // Bind event handlers
    this.setupEventHandlers();
  }

  /**
   * Start the scheduler daemon
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      return;
    }
    
    try {
      this.emit('starting');
      
      // Load configuration
      await this.loadConfiguration();
      
      // Setup configuration file watching
      if (this.watchConfig) {
        this.setupConfigWatcher();
      }
      
      // Schedule jobs based on configuration
      await this.scheduleJobsFromConfig();
      
      // Start the job scheduler
      this.scheduler.start();
      
      this.isRunning = true;
      this.emit('started');
      
    } catch (error) {
      this.emit('error', { type: 'startupError', error: error.message });
      throw error;
    }
  }

  /**
   * Stop the scheduler daemon
   * @param {number} [timeout=30000] - Shutdown timeout in milliseconds
   * @returns {Promise<void>}
   */
  async stop(timeout = 30000) {
    if (!this.isRunning || this.isShuttingDown) {
      return;
    }
    
    this.isShuttingDown = true;
    this.emit('stopping');
    
    try {
      // Stop configuration file watching
      if (this.configWatcher) {
        await this.configWatcher.close();
        this.configWatcher = null;
      }
      
      // Gracefully shutdown the scheduler
      await this.scheduler.shutdown(timeout);
      
      this.isRunning = false;
      this.isShuttingDown = false;
      this.emit('stopped');
      
    } catch (error) {
      this.emit('error', { type: 'shutdownError', error: error.message });
      throw error;
    }
  }

  /**
   * Reload configuration and reschedule jobs
   * @returns {Promise<void>}
   */
  async reloadConfiguration() {
    try {
      this.emit('reloadingConfig');
      
      // Store current configuration as backup
      const oldConfig = this.config;
      const oldJobs = this.scheduler.getAllJobs().map(job => ({
        jobId: job.jobId,
        enabled: job.enabled
      }));
      
      // Load and validate new configuration
      let newConfig;
      try {
        // Read and parse new configuration
        const configContent = await fs.readFile(this.configPath, 'utf8');
        newConfig = yaml.load(configContent);
        
        // Validate new configuration before applying
        this.validateConfiguration(newConfig);
        
      } catch (validationError) {
        // Configuration validation failed - keep old config
        this.emit('configValidationFailed', {
          error: validationError.message,
          configPath: this.configPath,
          keepingOldConfig: true
        });
        
        // Don't update this.config, keep the old one
        throw new Error(`Configuration validation failed: ${validationError.message}`);
      }
      
      // Apply new configuration
      this.config = newConfig;
      
      try {
        // Remove old jobs systematically
        await this.removeOldJobs(oldConfig);
        
        // Schedule new jobs based on updated configuration
        await this.scheduleJobsFromConfig();
        
        // Verify that critical jobs are running
        await this.verifyCriticalJobs();
        
        this.emit('configReloaded', {
          oldJobCount: oldJobs.length,
          newJobCount: this.scheduler.getAllJobs().length,
          configPath: this.configPath
        });
        
      } catch (jobSchedulingError) {
        // Job scheduling failed - attempt recovery
        this.emit('jobSchedulingFailed', {
          error: jobSchedulingError.message,
          attemptingRecovery: true
        });
        
        try {
          // Restore old configuration and jobs
          this.config = oldConfig;
          await this.removeAllJobs();
          await this.scheduleJobsFromConfig();
          
          this.emit('configRecovered', {
            restoredJobCount: this.scheduler.getAllJobs().length,
            error: jobSchedulingError.message
          });
          
        } catch (recoveryError) {
          // Recovery failed - this is a critical error
          this.emit('configRecoveryFailed', {
            originalError: jobSchedulingError.message,
            recoveryError: recoveryError.message
          });
          
          throw new Error(`Configuration reload failed and recovery failed: ${recoveryError.message}`);
        }
        
        throw jobSchedulingError;
      }
      
    } catch (error) {
      this.emit('error', { 
        type: 'configReloadError', 
        error: error.message,
        configPath: this.configPath
      });
      throw error;
    }
  }

  /**
   * Remove old jobs systematically
   * @param {Object} oldConfig - Previous configuration
   * @returns {Promise<void>}
   * @private
   */
  async removeOldJobs(oldConfig) {
    const jobsToRemove = [];
    
    // Collect site jobs to remove
    if (oldConfig && oldConfig.sites) {
      for (const site of oldConfig.sites) {
        jobsToRemove.push(`site-${site.siteId}`);
      }
    }
    
    // Collect system jobs to remove
    if (oldConfig && oldConfig.jobs) {
      if (oldConfig.jobs.cleanup) {
        jobsToRemove.push('system-cleanup');
      }
      if (oldConfig.jobs.healthCheck) {
        jobsToRemove.push('system-health-check');
      }
    }
    
    // Remove jobs with error handling
    const removalResults = [];
    for (const jobId of jobsToRemove) {
      try {
        const removed = this.scheduler.removeJob(jobId);
        removalResults.push({ jobId, removed, error: null });
      } catch (error) {
        removalResults.push({ jobId, removed: false, error: error.message });
      }
    }
    
    // Log removal results
    const failedRemovals = removalResults.filter(r => !r.removed);
    if (failedRemovals.length > 0) {
      this.emit('jobRemovalWarnings', {
        failedRemovals,
        totalAttempted: jobsToRemove.length
      });
    }
  }

  /**
   * Remove all jobs (used during recovery)
   * @returns {Promise<void>}
   * @private
   */
  async removeAllJobs() {
    const allJobs = this.scheduler.getAllJobs();
    for (const job of allJobs) {
      try {
        this.scheduler.removeJob(job.jobId);
      } catch (error) {
        // Log but don't fail - we're in recovery mode
        this.emit('jobRemovalError', {
          jobId: job.jobId,
          error: error.message
        });
      }
    }
  }

  /**
   * Verify that critical jobs are properly scheduled
   * @returns {Promise<void>}
   * @private
   */
  async verifyCriticalJobs() {
    const allJobs = this.scheduler.getAllJobs();
    const jobIds = allJobs.map(job => job.jobId);
    
    // Verify site jobs
    if (this.config && this.config.sites) {
      for (const site of this.config.sites) {
        if (site.enabled !== false) {
          const expectedJobId = `site-${site.siteId}`;
          if (!jobIds.includes(expectedJobId)) {
            throw new Error(`Critical site job missing: ${expectedJobId}`);
          }
          
          // Verify job is properly configured
          const jobInfo = this.scheduler.getJobInfo(expectedJobId);
          if (!jobInfo || !jobInfo.enabled) {
            throw new Error(`Critical site job not enabled: ${expectedJobId}`);
          }
        }
      }
    }
    
    // Verify system jobs
    if (this.config && this.config.jobs) {
      if (this.config.jobs.cleanup && this.config.jobs.cleanup.enabled) {
        if (!jobIds.includes('system-cleanup')) {
          throw new Error('Critical system cleanup job missing');
        }
      }
      
      if (this.config.jobs.healthCheck && this.config.jobs.healthCheck.enabled) {
        if (!jobIds.includes('system-health-check')) {
          throw new Error('Critical system health check job missing');
        }
      }
    }
  }

  /**
   * Enhanced configuration validation with detailed error reporting
   * @param {Object} config - Configuration to validate
   * @throws {Error} If configuration is invalid
   * @private
   */
  validateConfiguration(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration must be an object');
    }
    
    // Validate version
    if (config.version && typeof config.version !== 'string') {
      throw new Error('Configuration version must be a string');
    }
    
    // Validate scheduler section
    if (config.scheduler) {
      if (typeof config.scheduler !== 'object') {
        throw new Error('Configuration scheduler section must be an object');
      }
      
      if (config.scheduler.timezone && typeof config.scheduler.timezone !== 'string') {
        throw new Error('Scheduler timezone must be a string');
      }
      
      if (config.scheduler.outputDir && typeof config.scheduler.outputDir !== 'string') {
        throw new Error('Scheduler outputDir must be a string');
      }
    }
    
    // Validate sites array
    if (!config.sites || !Array.isArray(config.sites)) {
      throw new Error('Configuration must have a sites array');
    }
    
    // Validate each site configuration with detailed error messages
    const siteIds = new Set();
    for (let i = 0; i < config.sites.length; i++) {
      const site = config.sites[i];
      const sitePrefix = `Site ${i + 1}`;
      
      if (!site || typeof site !== 'object') {
        throw new Error(`${sitePrefix}: must be an object`);
      }
      
      if (!site.siteId || typeof site.siteId !== 'string') {
        throw new Error(`${sitePrefix}: must have a valid siteId string`);
      }
      
      // Check for duplicate site IDs
      if (siteIds.has(site.siteId)) {
        throw new Error(`${sitePrefix}: duplicate siteId '${site.siteId}'`);
      }
      siteIds.add(site.siteId);
      
      if (!site.siteName || typeof site.siteName !== 'string') {
        throw new Error(`${sitePrefix} (${site.siteId}): must have a valid siteName string`);
      }
      
      if (!site.domain || typeof site.domain !== 'string') {
        throw new Error(`${sitePrefix} (${site.siteId}): must have a valid domain string`);
      }
      
      // Validate domain format
      const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
      if (!domainRegex.test(site.domain)) {
        throw new Error(`${sitePrefix} (${site.siteId}): invalid domain format '${site.domain}'`);
      }
      
      if (!site.logPath || typeof site.logPath !== 'string') {
        throw new Error(`${sitePrefix} (${site.siteId}): must have a valid logPath string`);
      }
      
      if (!site.schedule || typeof site.schedule !== 'string') {
        throw new Error(`${sitePrefix} (${site.siteId}): must have a valid schedule string`);
      }
      
      // Validate schedule format
      try {
        const schedule = this.parseSchedule(site.schedule);
        if (!JobScheduler.validateCronExpression(schedule)) {
          throw new Error(`Invalid cron expression: ${schedule}`);
        }
      } catch (scheduleError) {
        throw new Error(`${sitePrefix} (${site.siteId}): invalid schedule '${site.schedule}' - ${scheduleError.message}`);
      }
      
      // Validate optional fields
      if (site.enabled !== undefined && typeof site.enabled !== 'boolean') {
        throw new Error(`${sitePrefix} (${site.siteId}): enabled must be a boolean`);
      }
      
      if (site.timezone && typeof site.timezone !== 'string') {
        throw new Error(`${sitePrefix} (${site.siteId}): timezone must be a string`);
      }
      
      // Validate parser options if present
      if (site.parserOptions) {
        this.validateParserOptions(site.parserOptions, `${sitePrefix} (${site.siteId})`);
      }
    }
    
    // Validate jobs section
    if (config.jobs) {
      this.validateJobsConfiguration(config.jobs);
    }
  }

  /**
   * Validate parser options
   * @param {Object} parserOptions - Parser options to validate
   * @param {string} context - Context for error messages
   * @throws {Error} If parser options are invalid
   * @private
   */
  validateParserOptions(parserOptions, context) {
    if (typeof parserOptions !== 'object') {
      throw new Error(`${context}: parserOptions must be an object`);
    }
    
    if (parserOptions.topContentLimit !== undefined) {
      if (!Number.isInteger(parserOptions.topContentLimit) || parserOptions.topContentLimit < 1) {
        throw new Error(`${context}: topContentLimit must be a positive integer`);
      }
    }
    
    if (parserOptions.referrerLimit !== undefined) {
      if (!Number.isInteger(parserOptions.referrerLimit) || parserOptions.referrerLimit < 1) {
        throw new Error(`${context}: referrerLimit must be a positive integer`);
      }
    }
    
    if (parserOptions.contentRanking) {
      if (typeof parserOptions.contentRanking !== 'object') {
        throw new Error(`${context}: contentRanking must be an object`);
      }
      
      if (parserOptions.contentRanking.excludePatterns) {
        if (!Array.isArray(parserOptions.contentRanking.excludePatterns)) {
          throw new Error(`${context}: contentRanking.excludePatterns must be an array`);
        }
        
        for (let i = 0; i < parserOptions.contentRanking.excludePatterns.length; i++) {
          if (typeof parserOptions.contentRanking.excludePatterns[i] !== 'string') {
            throw new Error(`${context}: contentRanking.excludePatterns[${i}] must be a string`);
          }
        }
      }
    }
  }

  /**
   * Validate jobs configuration
   * @param {Object} jobs - Jobs configuration to validate
   * @throws {Error} If jobs configuration is invalid
   * @private
   */
  validateJobsConfiguration(jobs) {
    if (typeof jobs !== 'object') {
      throw new Error('Jobs configuration must be an object');
    }
    
    // Validate cleanup job
    if (jobs.cleanup) {
      if (typeof jobs.cleanup !== 'object') {
        throw new Error('Cleanup job configuration must be an object');
      }
      
      if (jobs.cleanup.schedule && typeof jobs.cleanup.schedule !== 'string') {
        throw new Error('Cleanup job schedule must be a string');
      }
      
      if (jobs.cleanup.enabled !== undefined && typeof jobs.cleanup.enabled !== 'boolean') {
        throw new Error('Cleanup job enabled must be a boolean');
      }
      
      if (jobs.cleanup.options) {
        if (typeof jobs.cleanup.options !== 'object') {
          throw new Error('Cleanup job options must be an object');
        }
        
        if (jobs.cleanup.options.maxAge !== undefined) {
          if (!Number.isInteger(jobs.cleanup.options.maxAge) || jobs.cleanup.options.maxAge < 1) {
            throw new Error('Cleanup job maxAge must be a positive integer');
          }
        }
      }
    }
    
    // Validate health check job
    if (jobs.healthCheck) {
      if (typeof jobs.healthCheck !== 'object') {
        throw new Error('Health check job configuration must be an object');
      }
      
      if (jobs.healthCheck.schedule && typeof jobs.healthCheck.schedule !== 'string') {
        throw new Error('Health check job schedule must be a string');
      }
      
      if (jobs.healthCheck.enabled !== undefined && typeof jobs.healthCheck.enabled !== 'boolean') {
        throw new Error('Health check job enabled must be a boolean');
      }
    }
  }

  /**
   * Manually trigger configuration reload (useful for testing or manual operations)
   * @param {Object} [options] - Reload options
   * @param {boolean} [options.force=false] - Force reload even if file hasn't changed
   * @returns {Promise<void>}
   */
  async manualConfigReload(options = {}) {
    const force = options.force || false;
    
    try {
      this.emit('manualConfigReloadStarted', { force, timestamp: new Date() });
      
      if (!force) {
        // Check if config file has been modified since last load
        try {
          const stats = await fs.stat(this.configPath);
          const lastModified = stats.mtime;
          
          if (this.lastConfigLoad && lastModified <= this.lastConfigLoad) {
            this.emit('manualConfigReloadSkipped', {
              reason: 'File not modified since last load',
              lastModified,
              lastLoad: this.lastConfigLoad
            });
            return;
          }
        } catch (statError) {
          // If we can't stat the file, proceed with reload attempt
          this.emit('configFileStatFailed', { error: statError.message });
        }
      }
      
      await this.reloadConfiguration();
      
      this.emit('manualConfigReloadCompleted', { 
        force, 
        timestamp: new Date(),
        jobCount: this.scheduler.getAllJobs().length
      });
      
    } catch (error) {
      this.emit('manualConfigReloadFailed', {
        force,
        error: error.message,
        timestamp: new Date()
      });
      throw error;
    }
  }

  /**
   * Get detailed daemon status information including configuration health
   * @returns {Object} Comprehensive status information
   */
  getStatus() {
    const baseStatus = {
      isRunning: this.isRunning,
      isShuttingDown: this.isShuttingDown,
      configPath: this.configPath,
      configLoaded: this.config !== null,
      watchingConfig: this.configWatcher !== null,
      scheduler: this.scheduler.getStats(),
      executor: this.executor.getStats(),
      sites: this.config?.sites?.length || 0,
      uptime: this.isRunning && this.startTime ? new Date() - this.startTime : 0
    };
    
    // Add configuration health information
    if (this.config) {
      baseStatus.configHealth = {
        version: this.config.version || 'unknown',
        enabledSites: this.config.sites ? this.config.sites.filter(s => s.enabled !== false).length : 0,
        totalSites: this.config.sites ? this.config.sites.length : 0,
        systemJobs: {
          cleanup: this.config.jobs?.cleanup?.enabled || false,
          healthCheck: this.config.jobs?.healthCheck?.enabled || false
        },
        lastLoad: this.lastConfigLoad || null
      };
      
      // Add job status summary
      const allJobs = this.scheduler.getAllJobs();
      baseStatus.jobSummary = {
        total: allJobs.length,
        enabled: allJobs.filter(j => j.enabled).length,
        running: allJobs.filter(j => j.isRunning).length,
        withErrors: allJobs.filter(j => j.errorCount > 0).length
      };
    }
    
    return baseStatus;
  }

  /**
   * Load configuration from file with enhanced tracking
   * @returns {Promise<void>}
   * @private
   */
  async loadConfiguration() {
    try {
      // Check if config file exists
      await fs.access(this.configPath);
      
      // Read and parse configuration
      const configContent = await fs.readFile(this.configPath, 'utf8');
      const config = yaml.load(configContent);
      
      // Validate configuration
      this.validateConfiguration(config);
      
      this.config = config;
      this.lastConfigLoad = new Date();
      
      this.emit('configLoaded', { 
        configPath: this.configPath,
        timestamp: this.lastConfigLoad,
        sites: config.sites?.length || 0
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Create default configuration if file doesn't exist
        await this.createDefaultConfiguration();
        await this.loadConfiguration();
      } else {
        throw new Error(`Failed to load configuration: ${error.message}`);
      }
    }
  }

  /**
   * Create default configuration file
   * @returns {Promise<void>}
   * @private
   */
  async createDefaultConfiguration() {
    const defaultConfig = {
      version: '1.0',
      scheduler: {
        timezone: this.timezone,
        outputDir: this.outputDir
      },
      sites: [
        {
          siteId: 'example-site',
          siteName: 'Example Website',
          domain: 'example.com',
          logPath: '/var/log/nginx/example.com.access.log',
          schedule: 'daily',
          enabled: false,
          timezone: 'UTC',
          parserOptions: {
            topContentLimit: 20,
            referrerLimit: 10,
            contentRanking: {
              excludePatterns: [
                '\\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$',
                '^/admin/',
                '^/api/health'
              ]
            }
          }
        }
      ],
      jobs: {
        cleanup: {
          schedule: 'daily',
          enabled: true,
          options: {
            maxAge: 7
          }
        },
        healthCheck: {
          schedule: 'hourly',
          enabled: true
        }
      }
    };
    
    // Ensure config directory exists
    const configDir = path.dirname(this.configPath);
    await fs.mkdir(configDir, { recursive: true });
    
    // Write default configuration
    const yamlContent = yaml.dump(defaultConfig, {
      indent: 2,
      lineWidth: 120,
      noRefs: true
    });
    
    await fs.writeFile(this.configPath, yamlContent, 'utf8');
    
    this.emit('defaultConfigCreated', { configPath: this.configPath });
  }

  /**
   * Validate configuration structure
   * @param {Object} config - Configuration to validate
   * @throws {Error} If configuration is invalid
   * @private
   */
  validateConfiguration(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration must be an object');
    }
    
    if (!config.sites || !Array.isArray(config.sites)) {
      throw new Error('Configuration must have a sites array');
    }
    
    // Validate each site configuration
    for (const site of config.sites) {
      if (!site.siteId || typeof site.siteId !== 'string') {
        throw new Error('Each site must have a valid siteId');
      }
      
      if (!site.siteName || typeof site.siteName !== 'string') {
        throw new Error('Each site must have a valid siteName');
      }
      
      if (!site.domain || typeof site.domain !== 'string') {
        throw new Error('Each site must have a valid domain');
      }
      
      if (!site.logPath || typeof site.logPath !== 'string') {
        throw new Error('Each site must have a valid logPath');
      }
      
      if (!site.schedule || typeof site.schedule !== 'string') {
        throw new Error('Each site must have a valid schedule');
      }
      
      // Validate schedule format
      const schedule = this.parseSchedule(site.schedule);
      if (!JobScheduler.validateCronExpression(schedule)) {
        throw new Error(`Invalid schedule for site ${site.siteId}: ${site.schedule}`);
      }
    }
  }

  /**
   * Schedule jobs based on current configuration
   * @returns {Promise<void>}
   * @private
   */
  async scheduleJobsFromConfig() {
    if (!this.config || !this.config.sites) {
      return;
    }
    
    // Schedule site processing jobs
    for (const siteConfig of this.config.sites) {
      if (siteConfig.enabled === false) {
        continue;
      }
      
      const jobId = `site-${siteConfig.siteId}`;
      const cronExpression = this.parseSchedule(siteConfig.schedule);
      const jobFunction = this.executor.createSiteProcessingJob(siteConfig);
      
      const success = this.scheduler.scheduleJob(jobId, cronExpression, jobFunction, {
        description: `Analytics processing for ${siteConfig.siteName}`,
        context: { siteConfig }
      });
      
      if (success) {
        this.emit('jobScheduled', { 
          jobId, 
          siteId: siteConfig.siteId, 
          schedule: siteConfig.schedule 
        });
      }
    }
    
    // Schedule system jobs
    if (this.config.jobs) {
      // Cleanup job
      if (this.config.jobs.cleanup && this.config.jobs.cleanup.enabled) {
        const cleanupJob = this.executor.createCleanupJob(this.config.jobs.cleanup.options);
        const cleanupSchedule = this.parseSchedule(this.config.jobs.cleanup.schedule);
        
        this.scheduler.scheduleJob('system-cleanup', cleanupSchedule, cleanupJob, {
          description: 'Cleanup old backup files'
        });
      }
      
      // Health check job
      if (this.config.jobs.healthCheck && this.config.jobs.healthCheck.enabled) {
        const healthCheckJob = this.executor.createHealthCheckJob(this.config.sites);
        const healthCheckSchedule = this.parseSchedule(this.config.jobs.healthCheck.schedule);
        
        this.scheduler.scheduleJob('system-health-check', healthCheckSchedule, healthCheckJob, {
          description: 'System health check'
        });
      }
    }
  }

  /**
   * Parse schedule string to cron expression
   * @param {string} schedule - Schedule string (e.g., 'daily', 'hourly', '0 0 * * *')
   * @returns {string} Cron expression
   * @private
   */
  parseSchedule(schedule) {
    const commonSchedules = JobScheduler.getCronExpressions();
    
    // Check if it's a common schedule name
    if (commonSchedules[schedule]) {
      return commonSchedules[schedule];
    }
    
    // Check if it's already a cron expression
    if (JobScheduler.validateCronExpression(schedule)) {
      return schedule;
    }
    
    // Try to parse common formats
    switch (schedule.toLowerCase()) {
      case 'every-minute':
        return commonSchedules.everyMinute;
      case 'every-hour':
      case 'hourly':
        return commonSchedules.hourly;
      case 'every-day':
      case 'daily':
        return commonSchedules.daily;
      case 'every-week':
      case 'weekly':
        return commonSchedules.weekly;
      case 'every-month':
      case 'monthly':
        return commonSchedules.monthly;
      default:
        throw new Error(`Unknown schedule format: ${schedule}`);
    }
  }

  /**
   * Setup configuration file watcher with enhanced error handling
   * @returns {void}
   * @private
   */
  setupConfigWatcher() {
    if (this.configWatcher) {
      return;
    }
    
    this.configWatcher = chokidar.watch(this.configPath, {
      persistent: true,
      ignoreInitial: true,
      // Add stability checks to avoid rapid reloads
      awaitWriteFinish: {
        stabilityThreshold: 1000,  // Wait 1 second for file to stabilize
        pollInterval: 100
      },
      // Handle various file system events
      ignorePermissionErrors: false
    });
    
    // Track reload attempts to prevent excessive reloading
    let lastReloadAttempt = 0;
    const minReloadInterval = 5000; // Minimum 5 seconds between reloads
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 3;
    
    this.configWatcher.on('change', async (path) => {
      const now = Date.now();
      
      // Prevent excessive reloading
      if (now - lastReloadAttempt < minReloadInterval) {
        this.emit('configReloadThrottled', {
          path,
          timeSinceLastAttempt: now - lastReloadAttempt,
          minInterval: minReloadInterval
        });
        return;
      }
      
      lastReloadAttempt = now;
      
      try {
        this.emit('configFileChanged', { path, timestamp: new Date() });
        
        await this.reloadConfiguration();
        
        // Reset failure counter on success
        consecutiveFailures = 0;
        
      } catch (error) {
        consecutiveFailures++;
        
        this.emit('configReloadFailed', {
          path,
          error: error.message,
          consecutiveFailures,
          maxFailures: maxConsecutiveFailures
        });
        
        // If too many consecutive failures, temporarily disable watching
        if (consecutiveFailures >= maxConsecutiveFailures) {
          this.emit('configWatcherDisabled', {
            reason: 'Too many consecutive reload failures',
            consecutiveFailures,
            path
          });
          
          // Disable watcher temporarily
          await this.configWatcher.close();
          this.configWatcher = null;
          
          // Re-enable after a delay
          setTimeout(() => {
            if (!this.isShuttingDown) {
              this.emit('configWatcherReenabling', { path });
              consecutiveFailures = 0;
              this.setupConfigWatcher();
            }
          }, 30000); // Re-enable after 30 seconds
        }
      }
    });
    
    this.configWatcher.on('unlink', (path) => {
      this.emit('configFileDeleted', { 
        path, 
        timestamp: new Date(),
        action: 'Configuration file was deleted - keeping current configuration'
      });
    });
    
    this.configWatcher.on('add', (path) => {
      this.emit('configFileCreated', { 
        path, 
        timestamp: new Date(),
        action: 'Configuration file was created - attempting reload'
      });
      
      // Attempt to reload when config file is recreated
      setTimeout(async () => {
        try {
          await this.reloadConfiguration();
        } catch (error) {
          this.emit('error', { 
            type: 'configReloadError', 
            error: error.message,
            trigger: 'file_created'
          });
        }
      }, 1000); // Wait a bit for file to be fully written
    });
    
    this.configWatcher.on('error', (error) => {
      this.emit('configWatcherError', { 
        error: error.message,
        timestamp: new Date()
      });
      
      // Try to recover from watcher errors
      setTimeout(() => {
        if (!this.isShuttingDown && this.configWatcher) {
          try {
            this.configWatcher.close();
            this.configWatcher = null;
            this.setupConfigWatcher();
            this.emit('configWatcherRecovered', { timestamp: new Date() });
          } catch (recoveryError) {
            this.emit('configWatcherRecoveryFailed', { 
              error: recoveryError.message,
              timestamp: new Date()
            });
          }
        }
      }, 5000);
    });
    
    this.emit('configWatcherStarted', { 
      path: this.configPath,
      timestamp: new Date()
    });
  }

  /**
   * Setup event handlers for scheduler and executor
   * @returns {void}
   * @private
   */
  setupEventHandlers() {
    // Forward scheduler events with enhanced logging
    this.scheduler.on('jobStarted', (data) => {
      this.logStructuredEvent('INFO', 'JobStarted', data);
      this.emit('jobStarted', data);
    });
    
    this.scheduler.on('jobCompleted', (data) => {
      const level = data.success ? 'INFO' : 'ERROR';
      this.logStructuredEvent(level, 'JobCompleted', data);
      this.emit('jobCompleted', data);
    });
    
    this.scheduler.on('error', (data) => {
      this.logStructuredEvent('ERROR', 'SchedulerError', data);
      this.emit('error', data);
    });
    
    // Handle structured logging from scheduler
    this.scheduler.on('structuredLog', (logEntry) => {
      this.emit('structuredLog', logEntry);
    });
    
    // Track start time when scheduler starts
    this.scheduler.on('schedulerStarted', () => {
      this.startTime = new Date();
      this.logStructuredEvent('INFO', 'SchedulerStarted', { timestamp: this.startTime });
    });
    
    // Handle graceful shutdown events
    this.scheduler.on('shutdownStarted', () => {
      this.logStructuredEvent('INFO', 'ShutdownStarted', { timestamp: new Date() });
    });
    
    this.scheduler.on('shutdownCompleted', () => {
      this.logStructuredEvent('INFO', 'ShutdownCompleted', { timestamp: new Date() });
    });
    
    this.scheduler.on('shutdownForced', (data) => {
      this.logStructuredEvent('WARN', 'ShutdownForced', data);
    });
    
    // Handle configuration events with structured logging
    this.on('configLoaded', (data) => {
      this.logStructuredEvent('INFO', 'ConfigLoaded', data);
    });
    
    this.on('configReloaded', (data) => {
      this.logStructuredEvent('INFO', 'ConfigReloaded', data);
    });
    
    this.on('configValidationFailed', (data) => {
      this.logStructuredEvent('ERROR', 'ConfigValidationFailed', data);
    });
    
    this.on('configRecovered', (data) => {
      this.logStructuredEvent('WARN', 'ConfigRecovered', data);
    });
    
    this.on('configRecoveryFailed', (data) => {
      this.logStructuredEvent('ERROR', 'ConfigRecoveryFailed', data);
    });
  }

  /**
   * Log structured events for monitoring and debugging
   * @param {string} level - Log level (INFO, WARN, ERROR)
   * @param {string} eventType - Type of event
   * @param {Object} data - Event data
   * @private
   */
  logStructuredEvent(level, eventType, data) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: 'SchedulerDaemon',
      eventType,
      data: this.sanitizeLogData(data)
    };
    
    // Emit for external logging systems
    this.emit('structuredLog', logEntry);
    
    // Console logging with appropriate level
    const message = `[${logEntry.timestamp}] ${level} ${logEntry.component}: ${eventType}`;
    
    switch (level) {
      case 'ERROR':
        console.error(message);
        if (data.error || data.message) {
          console.error(`  Error: ${data.error || data.message}`);
        }
        break;
      case 'WARN':
        console.warn(message);
        break;
      case 'INFO':
        console.log(message);
        break;
    }
    
    // Log additional context for debugging
    if (process.env.NODE_ENV !== 'production' && Object.keys(logEntry.data).length > 0) {
      console.log(`  Data: ${JSON.stringify(logEntry.data, null, 2)}`);
    }
  }

  /**
   * Sanitize log data to remove sensitive information
   * @param {Object} data - Data to sanitize
   * @returns {Object} Sanitized data
   * @private
   */
  sanitizeLogData(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }
    
    const sanitized = { ...data };
    
    // Drop credential-like fields (secrets, tokens, passwords, API keys)
    for (const key of Object.keys(sanitized)) {
      if (/secret|token|passw(or)?d|api[-_]?key|credential/i.test(key)) {
        delete sanitized[key];
      }
    }
    
    // Remove or sanitize sensitive fields
    if (sanitized.configPath) {
      sanitized.configPath = sanitized.configPath.replace(/\/home\/[^\/]+/, '/home/***');
    }
    
    if (sanitized.outputPath) {
      sanitized.outputPath = sanitized.outputPath.replace(/\/home\/[^\/]+/, '/home/***');
    }
    
    // Remove stack traces from general logging (keep in structured logs)
    if (sanitized.stack && process.env.NODE_ENV === 'production') {
      delete sanitized.stack;
    }
    
    // Limit error context to essential information
    if (sanitized.context && typeof sanitized.context === 'object') {
      const contextKeys = Object.keys(sanitized.context);
      if (contextKeys.length > 5) {
        sanitized.context = {
          ...Object.fromEntries(contextKeys.slice(0, 5).map(k => [k, sanitized.context[k]])),
          '...': `${contextKeys.length - 5} more fields`
        };
      }
    }
    
    return sanitized;
  }
}

module.exports = {
  ConfigurationManager,
  SchedulerDaemon
};