/**
 * @fileoverview Main scheduler daemon for automated analytics processing
 * Feature: metrona-analytics-system, Requirements 2.1, 2.2, 2.3, 2.5, 2.6
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const chokidar = require('chokidar');
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
      
      // Load new configuration
      const oldConfig = this.config;
      await this.loadConfiguration();
      
      // Remove old jobs
      if (oldConfig && oldConfig.sites) {
        for (const site of oldConfig.sites) {
          this.scheduler.removeJob(`site-${site.siteId}`);
        }
      }
      
      // Schedule new jobs
      await this.scheduleJobsFromConfig();
      
      this.emit('configReloaded');
      
    } catch (error) {
      this.emit('error', { type: 'configReloadError', error: error.message });
      throw error;
    }
  }

  /**
   * Get daemon status information
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isShuttingDown: this.isShuttingDown,
      configPath: this.configPath,
      configLoaded: this.config !== null,
      watchingConfig: this.configWatcher !== null,
      scheduler: this.scheduler.getStats(),
      executor: this.executor.getStats(),
      sites: this.config?.sites?.length || 0,
      uptime: this.isRunning ? new Date() - this.startTime : 0
    };
  }

  /**
   * Load configuration from file
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
      this.emit('configLoaded', { configPath: this.configPath });
      
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
   * Setup configuration file watcher
   * @returns {void}
   * @private
   */
  setupConfigWatcher() {
    if (this.configWatcher) {
      return;
    }
    
    this.configWatcher = chokidar.watch(this.configPath, {
      persistent: true,
      ignoreInitial: true
    });
    
    this.configWatcher.on('change', async () => {
      try {
        await this.reloadConfiguration();
      } catch (error) {
        this.emit('error', { 
          type: 'configWatchError', 
          error: error.message 
        });
      }
    });
    
    this.configWatcher.on('error', (error) => {
      this.emit('error', { 
        type: 'configWatchError', 
        error: error.message 
      });
    });
  }

  /**
   * Setup event handlers for scheduler and executor
   * @returns {void}
   * @private
   */
  setupEventHandlers() {
    // Forward scheduler events
    this.scheduler.on('jobStarted', (data) => {
      this.emit('jobStarted', data);
    });
    
    this.scheduler.on('jobCompleted', (data) => {
      this.emit('jobCompleted', data);
    });
    
    this.scheduler.on('error', (data) => {
      this.emit('error', data);
    });
    
    // Track start time when scheduler starts
    this.scheduler.on('schedulerStarted', () => {
      this.startTime = new Date();
    });
  }
}

module.exports = {
  SchedulerDaemon
};