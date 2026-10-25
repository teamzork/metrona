/**
 * @fileoverview Configuration management system for analytics processing
 * Feature: metrona-analytics-system, Requirements 3.1, 3.2, 3.3, 3.5, 3.6
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { JobScheduler } = require('./job-scheduler');
const { BackupManager } = require('./backup-manager');

/**
 * Configuration validation and storage manager
 */
class ConfigurationManager {
  /**
   * @param {Object} [options] - Configuration options
   * @param {string} [options.configPath] - Path to configuration file
   * @param {boolean} [options.createBackups=true] - Whether to create backups
   * @param {string} [options.backupDir] - Directory for configuration backups
   */
  constructor(options = {}) {
    this.configPath = options.configPath || './config/analytics.yaml';
    this.createBackups = options.createBackups !== false;
    this.backupDir = options.backupDir || path.join(path.dirname(this.configPath), 'backups');
    
    // Initialize backup manager
    this.backupManager = new BackupManager({
      backupDir: this.backupDir,
      maxBackups: options.maxBackups || 10,
      filePermissions: 0o600
    });
    
    // Validation patterns
    this.domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    this.pathPattern = /^\/[a-zA-Z0-9._/-]*$/;
    
    // Supported schedule formats
    this.scheduleFormats = [
      'daily', 'hourly', 'weekly', 'monthly',
      'every-minute', 'every-hour', 'every-day', 'every-week', 'every-month'
    ];
    
    // Track operation history for rollback
    this.operationHistory = [];
  }

  /**
   * Load and validate configuration from file
   * @returns {Promise<Object>} Validated configuration object
   * @throws {Error} If configuration is invalid or file cannot be read
   */
  async loadConfiguration() {
    try {
      // Check if config file exists
      await fs.access(this.configPath);
      
      // Read and parse configuration
      const configContent = await fs.readFile(this.configPath, 'utf8');
      const config = yaml.load(configContent);
      
      // Validate configuration structure and content
      this.validateConfiguration(config);
      
      return config;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Configuration file not found: ${this.configPath}`);
      }
      
      if (error.name === 'YAMLException') {
        throw new Error(`Invalid YAML format in configuration file: ${error.message}`);
      }
      
      throw error;
    }
  }

  /**
   * Save configuration to file with validation and backup
   * @param {Object} config - Configuration object to save
   * @param {Object} [options] - Save options
   * @param {string} [options.operationLabel] - Label for the operation (for rollback)
   * @returns {Promise<string>} Path to backup file (if created)
   * @throws {Error} If configuration is invalid or cannot be saved
   */
  async saveConfiguration(config, options = {}) {
    // Validate configuration before saving
    this.validateConfiguration(config);
    
    let backupPath = null;
    
    // Create backup if file exists and backups are enabled
    if (this.createBackups) {
      try {
        await fs.access(this.configPath);
        backupPath = await this.backupManager.createBackup(this.configPath, {
          label: options.operationLabel || 'config-update',
          metadata: {
            operation: options.operationLabel || 'configuration update',
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        // File doesn't exist, no backup needed
        if (error.code !== 'ENOENT') {
          throw new Error(`Failed to create backup: ${error.message}`);
        }
      }
    }
    
    try {
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      
      // Convert to YAML with proper formatting
      const yamlContent = yaml.dump(config, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        sortKeys: true
      });
      
      // Write configuration file
      await fs.writeFile(this.configPath, yamlContent, 'utf8');
      
      // Set secure permissions
      await this.backupManager.setSecurePermissions(this.configPath);
      
      // Record operation for rollback
      if (backupPath) {
        this.operationHistory.push({
          timestamp: new Date().toISOString(),
          operation: options.operationLabel || 'configuration update',
          backupPath: backupPath,
          configPath: this.configPath
        });
        
        // Keep only recent operations
        if (this.operationHistory.length > 20) {
          this.operationHistory = this.operationHistory.slice(-20);
        }
      }
      
      return backupPath;
      
    } catch (error) {
      // If save failed and we created a backup, we might want to restore it
      throw new Error(`Failed to save configuration: ${error.message}`);
    }
  }

  /**
   * Add a new site to the configuration
   * @param {Object} siteConfig - Site configuration object
   * @param {string} siteConfig.siteId - Unique site identifier
   * @param {string} siteConfig.siteName - Human-readable site name
   * @param {string} siteConfig.domain - Site domain name
   * @param {string} siteConfig.logPath - Path to nginx log file
   * @param {string} siteConfig.schedule - Processing schedule
   * @param {boolean} [siteConfig.enabled=true] - Whether site is enabled
   * @param {string} [siteConfig.timezone='UTC'] - Site timezone
   * @param {Object} [siteConfig.parserOptions] - Parser configuration options
   * @returns {Promise<Object>} Updated configuration
   * @throws {Error} If site configuration is invalid
   */
  async addSite(siteConfig) {
    // Validate site configuration
    this.validateSiteConfiguration(siteConfig);
    
    // Load current configuration
    let config;
    try {
      config = await this.loadConfiguration();
    } catch (error) {
      // Create default configuration if none exists
      config = this.createDefaultConfiguration();
    }
    
    // Check for duplicate site ID
    if (config.sites && config.sites.some(site => site.siteId === siteConfig.siteId)) {
      throw new Error(`Site with ID '${siteConfig.siteId}' already exists`);
    }
    
    // Check for duplicate domain
    if (config.sites && config.sites.some(site => site.domain === siteConfig.domain)) {
      throw new Error(`Site with domain '${siteConfig.domain}' already exists`);
    }
    
    // Add site to configuration
    if (!config.sites) {
      config.sites = [];
    }
    
    const newSite = {
      siteId: siteConfig.siteId,
      siteName: siteConfig.siteName,
      domain: siteConfig.domain,
      logPath: siteConfig.logPath,
      schedule: siteConfig.schedule,
      enabled: siteConfig.enabled !== false,
      timezone: siteConfig.timezone || 'UTC',
      ...(siteConfig.parserOptions && { parserOptions: siteConfig.parserOptions })
    };
    
    config.sites.push(newSite);
    
    // Save updated configuration
    await this.saveConfiguration(config, { operationLabel: `add-site-${siteConfig.siteId}` });
    
    return config;
  }

  /**
   * Remove a site from the configuration
   * @param {string} siteId - Site ID to remove
   * @returns {Promise<Object>} Updated configuration
   * @throws {Error} If site is not found
   */
  async removeSite(siteId) {
    const config = await this.loadConfiguration();
    
    if (!config.sites || config.sites.length === 0) {
      throw new Error('No sites configured');
    }
    
    const siteIndex = config.sites.findIndex(site => site.siteId === siteId);
    if (siteIndex === -1) {
      throw new Error(`Site with ID '${siteId}' not found`);
    }
    
    // Remove site from configuration
    config.sites.splice(siteIndex, 1);
    
    // Save updated configuration
    await this.saveConfiguration(config, { operationLabel: `remove-site-${siteId}` });
    
    return config;
  }

  /**
   * Update site configuration
   * @param {string} siteId - Site ID to update
   * @param {Object} updates - Configuration updates
   * @returns {Promise<Object>} Updated configuration
   * @throws {Error} If site is not found or updates are invalid
   */
  async updateSite(siteId, updates) {
    const config = await this.loadConfiguration();
    
    if (!config.sites) {
      throw new Error('No sites configured');
    }
    
    const siteIndex = config.sites.findIndex(site => site.siteId === siteId);
    if (siteIndex === -1) {
      throw new Error(`Site with ID '${siteId}' not found`);
    }
    
    // Create updated site configuration
    const updatedSite = { ...config.sites[siteIndex], ...updates };
    
    // Validate updated site configuration
    this.validateSiteConfiguration(updatedSite);
    
    // Check for domain conflicts (if domain is being changed)
    if (updates.domain && updates.domain !== config.sites[siteIndex].domain) {
      const domainExists = config.sites.some((site, index) => 
        index !== siteIndex && site.domain === updates.domain
      );
      if (domainExists) {
        throw new Error(`Site with domain '${updates.domain}' already exists`);
      }
    }
    
    // Update site in configuration
    config.sites[siteIndex] = updatedSite;
    
    // Save updated configuration
    await this.saveConfiguration(config, { operationLabel: `update-site-${siteId}` });
    
    return config;
  }

  /**
   * Enable or disable a site
   * @param {string} siteId - Site ID to update
   * @param {boolean} enabled - Whether site should be enabled
   * @returns {Promise<Object>} Updated configuration
   */
  async setSiteEnabled(siteId, enabled) {
    return this.updateSite(siteId, { enabled });
  }

  /**
   * Get list of enabled sites
   * @returns {Promise<Array>} Array of enabled site configurations
   */
  async getEnabledSites() {
    const config = await this.loadConfiguration();
    
    if (!config.sites) {
      return [];
    }
    
    return config.sites.filter(site => site.enabled !== false);
  }

  /**
   * Validate complete configuration object
   * @param {Object} config - Configuration to validate
   * @throws {Error} If configuration is invalid
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
      this.validateSchedulerConfiguration(config.scheduler);
    }
    
    // Validate sites array
    if (!config.sites || !Array.isArray(config.sites)) {
      throw new Error('Configuration must have a sites array');
    }
    
    // Validate each site configuration
    const siteIds = new Set();
    const domains = new Set();
    
    for (let i = 0; i < config.sites.length; i++) {
      const site = config.sites[i];
      const sitePrefix = `Site ${i + 1}`;
      
      try {
        this.validateSiteConfiguration(site);
      } catch (error) {
        throw new Error(`${sitePrefix}: ${error.message}`);
      }
      
      // Check for duplicate site IDs
      if (siteIds.has(site.siteId)) {
        throw new Error(`${sitePrefix}: duplicate siteId '${site.siteId}'`);
      }
      siteIds.add(site.siteId);
      
      // Check for duplicate domains
      if (domains.has(site.domain)) {
        throw new Error(`${sitePrefix}: duplicate domain '${site.domain}'`);
      }
      domains.add(site.domain);
    }
    
    // Validate jobs section
    if (config.jobs) {
      this.validateJobsConfiguration(config.jobs);
    }
  }

  /**
   * Validate site configuration object
   * @param {Object} site - Site configuration to validate
   * @throws {Error} If site configuration is invalid
   */
  validateSiteConfiguration(site) {
    if (!site || typeof site !== 'object') {
      throw new Error('Site configuration must be an object');
    }
    
    // Validate required fields
    if (!site.siteId || typeof site.siteId !== 'string') {
      throw new Error('Site must have a valid siteId string');
    }
    
    if (!site.siteName || typeof site.siteName !== 'string') {
      throw new Error('Site must have a valid siteName string');
    }
    
    if (!site.domain || typeof site.domain !== 'string') {
      throw new Error('Site must have a valid domain string');
    }
    
    if (!site.logPath || typeof site.logPath !== 'string') {
      throw new Error('Site must have a valid logPath string');
    }
    
    if (!site.schedule || typeof site.schedule !== 'string') {
      throw new Error('Site must have a valid schedule string');
    }
    
    // Validate domain format
    if (!this.validateDomainName(site.domain)) {
      throw new Error(`Invalid domain format: '${site.domain}'`);
    }
    
    // Validate log path format
    if (!this.validateLogPath(site.logPath)) {
      throw new Error(`Invalid log path format: '${site.logPath}'`);
    }
    
    // Validate schedule format
    if (!this.validateSchedule(site.schedule)) {
      throw new Error(`Invalid schedule format: '${site.schedule}'`);
    }
    
    // Validate optional fields
    if (site.enabled !== undefined && typeof site.enabled !== 'boolean') {
      throw new Error('Site enabled field must be a boolean');
    }
    
    if (site.timezone && typeof site.timezone !== 'string') {
      throw new Error('Site timezone must be a string');
    }
    
    if (site.format !== undefined && !['nginx', 'caddy'].includes(site.format)) {
      throw new Error(`Site format must be 'nginx' or 'caddy', got '${site.format}'`);
    }
    
    if (site.rotationNaming !== undefined && !['suffix', 'caddy'].includes(site.rotationNaming)) {
      throw new Error(`Site rotationNaming must be 'suffix' or 'caddy', got '${site.rotationNaming}'`);
    }
    
    if (site.aliases !== undefined) {
      if (!Array.isArray(site.aliases) || !site.aliases.every(a => typeof a === 'string' && this.validateDomainName(a))) {
        throw new Error('Site aliases must be a list of domain names');
      }
    }
    
    // Validate parser options if present
    if (site.parserOptions) {
      this.validateParserOptions(site.parserOptions);
    }
  }

  /**
   * Validate domain name format
   * @param {string} domain - Domain name to validate
   * @returns {boolean} True if domain is valid
   */
  validateDomainName(domain) {
    if (typeof domain !== 'string' || domain.length === 0) {
      return false;
    }
    
    // Check basic domain format - allow single character domains
    if (domain.length === 1) {
      return /^[a-zA-Z0-9]$/.test(domain);
    }
    
    // For multi-character domains, use the original pattern
    if (!this.domainPattern.test(domain)) {
      return false;
    }
    
    // Additional checks
    if (domain.length > 253) {
      return false;
    }
    
    // Check each label length
    const labels = domain.split('.');
    for (const label of labels) {
      if (label.length === 0 || label.length > 63) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Validate log file path
   * @param {string} logPath - Log file path to validate
   * @returns {boolean} True if path is valid
   */
  validateLogPath(logPath) {
    if (typeof logPath !== 'string' || logPath.length === 0) {
      return false;
    }
    
    // Must be absolute path
    if (!path.isAbsolute(logPath)) {
      return false;
    }
    
    // Check for dangerous patterns
    if (logPath.includes('..') || logPath.includes('//')) {
      return false;
    }
    
    // Must end with .log or be a directory
    const ext = path.extname(logPath);
    if (ext && ext !== '.log') {
      return false;
    }
    
    return true;
  }

  /**
   * Validate schedule format
   * @param {string} schedule - Schedule string to validate
   * @returns {boolean} True if schedule is valid
   */
  validateSchedule(schedule) {
    if (typeof schedule !== 'string' || schedule.length === 0) {
      return false;
    }
    
    // Check if it's a predefined schedule format
    if (this.scheduleFormats.includes(schedule.toLowerCase())) {
      return true;
    }
    
    // Check if it's a valid cron expression
    try {
      return JobScheduler.validateCronExpression(schedule);
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate scheduler configuration
   * @param {Object} scheduler - Scheduler configuration to validate
   * @throws {Error} If scheduler configuration is invalid
   */
  validateSchedulerConfiguration(scheduler) {
    if (typeof scheduler !== 'object') {
      throw new Error('Scheduler configuration must be an object');
    }
    
    if (scheduler.timezone && typeof scheduler.timezone !== 'string') {
      throw new Error('Scheduler timezone must be a string');
    }
    
    if (scheduler.outputDir && typeof scheduler.outputDir !== 'string') {
      throw new Error('Scheduler outputDir must be a string');
    }
    
    if (scheduler.outputDir && !path.isAbsolute(scheduler.outputDir)) {
      throw new Error('Scheduler outputDir must be an absolute path');
    }
  }

  /**
   * Validate parser options
   * @param {Object} parserOptions - Parser options to validate
   * @throws {Error} If parser options are invalid
   */
  validateParserOptions(parserOptions) {
    if (typeof parserOptions !== 'object') {
      throw new Error('Parser options must be an object');
    }
    
    if (parserOptions.topContentLimit !== undefined) {
      if (!Number.isInteger(parserOptions.topContentLimit) || parserOptions.topContentLimit < 1) {
        throw new Error('topContentLimit must be a positive integer');
      }
    }
    
    if (parserOptions.referrerLimit !== undefined) {
      if (!Number.isInteger(parserOptions.referrerLimit) || parserOptions.referrerLimit < 1) {
        throw new Error('referrerLimit must be a positive integer');
      }
    }
    
    if (parserOptions.contentRanking) {
      if (typeof parserOptions.contentRanking !== 'object') {
        throw new Error('contentRanking must be an object');
      }
      
      if (parserOptions.contentRanking.excludePatterns) {
        if (!Array.isArray(parserOptions.contentRanking.excludePatterns)) {
          throw new Error('excludePatterns must be an array');
        }
        
        for (let i = 0; i < parserOptions.contentRanking.excludePatterns.length; i++) {
          if (typeof parserOptions.contentRanking.excludePatterns[i] !== 'string') {
            throw new Error(`excludePatterns[${i}] must be a string`);
          }
        }
      }
    }
  }

  /**
   * Validate jobs configuration
   * @param {Object} jobs - Jobs configuration to validate
   * @throws {Error} If jobs configuration is invalid
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
      
      if (jobs.cleanup.schedule && !this.validateSchedule(jobs.cleanup.schedule)) {
        throw new Error('Cleanup job schedule is invalid');
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
      
      if (jobs.healthCheck.schedule && !this.validateSchedule(jobs.healthCheck.schedule)) {
        throw new Error('Health check job schedule is invalid');
      }
      
      if (jobs.healthCheck.enabled !== undefined && typeof jobs.healthCheck.enabled !== 'boolean') {
        throw new Error('Health check job enabled must be a boolean');
      }
    }
  }

  /**
   * Rollback to a previous configuration
   * @param {string} [backupPath] - Specific backup to restore (defaults to most recent)
   * @param {Object} [options] - Rollback options
   * @param {boolean} [options.createBackupBeforeRollback=true] - Create backup before rollback
   * @returns {Promise<Object>} Restored configuration
   * @throws {Error} If rollback fails
   */
  async rollbackConfiguration(backupPath = null, options = {}) {
    const createBackupBeforeRollback = options.createBackupBeforeRollback !== false;
    
    try {
      let targetBackupPath = backupPath;
      
      // If no specific backup specified, use the most recent
      if (!targetBackupPath) {
        const backups = await this.backupManager.listBackups(this.configPath);
        if (backups.length === 0) {
          throw new Error('No backups available for rollback');
        }
        targetBackupPath = backups[0].backupPath;
      }
      
      // Create backup of current state before rollback
      let preRollbackBackup = null;
      if (createBackupBeforeRollback) {
        try {
          preRollbackBackup = await this.backupManager.createBackup(this.configPath, {
            label: 'pre-rollback',
            metadata: {
              operation: 'pre-rollback backup',
              rollingBackFrom: targetBackupPath
            }
          });
        } catch (error) {
          // If current file doesn't exist, that's okay
          if (error.code !== 'ENOENT') {
            console.warn(`Could not create pre-rollback backup: ${error.message}`);
          }
        }
      }
      
      // Restore from backup
      const restoredPath = await this.backupManager.restoreFromBackup(
        targetBackupPath,
        this.configPath,
        { createBackupBeforeRestore: false } // We already created one above
      );
      
      // Load and validate the restored configuration
      const restoredConfig = await this.loadConfiguration();
      
      // Record rollback operation
      this.operationHistory.push({
        timestamp: new Date().toISOString(),
        operation: 'rollback',
        backupPath: targetBackupPath,
        preRollbackBackup: preRollbackBackup,
        configPath: this.configPath
      });
      
      return restoredConfig;
      
    } catch (error) {
      throw new Error(`Failed to rollback configuration: ${error.message}`);
    }
  }

  /**
   * List available configuration backups
   * @returns {Promise<Array>} Array of backup information
   */
  async listConfigurationBackups() {
    return this.backupManager.listBackups(this.configPath);
  }

  /**
   * Get backup and operation statistics
   * @returns {Promise<Object>} Statistics about backups and operations
   */
  async getBackupStatistics() {
    const backupStats = await this.backupManager.getBackupStats();
    
    return {
      ...backupStats,
      recentOperations: this.operationHistory.slice(-10),
      configurationFile: this.configPath,
      backupDirectory: this.backupDir,
      securePermissions: await this.verifyConfigurationSecurity()
    };
  }

  /**
   * Verify configuration file security
   * @returns {Promise<Object>} Security verification results
   */
  async verifyConfigurationSecurity() {
    try {
      const configSecure = await this.backupManager.verifySecurePermissions(this.configPath);
      
      // Check backup directory permissions
      let backupDirSecure = false;
      try {
        await fs.access(this.backupDir);
        const stats = await fs.stat(this.backupDir);
        const mode = stats.mode & parseInt('777', 8);
        backupDirSecure = (mode & parseInt('077', 8)) === 0; // No group/other permissions
      } catch (error) {
        // Backup directory doesn't exist yet
        backupDirSecure = true;
      }
      
      return {
        configurationFile: {
          path: this.configPath,
          secure: configSecure,
          exists: true
        },
        backupDirectory: {
          path: this.backupDir,
          secure: backupDirSecure
        }
      };
      
    } catch (error) {
      return {
        configurationFile: {
          path: this.configPath,
          secure: false,
          exists: false,
          error: error.message
        },
        backupDirectory: {
          path: this.backupDir,
          secure: false,
          error: 'Could not verify'
        }
      };
    }
  }

  /**
   * Cleanup old backups and operation history
   * @param {Object} [options] - Cleanup options
   * @param {number} [options.keepBackups] - Number of backups to keep
   * @param {number} [options.maxAge] - Maximum age in days for backups
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanupBackups(options = {}) {
    const keepBackups = options.keepBackups || this.backupManager.maxBackups;
    const maxAge = options.maxAge || 30; // 30 days default
    
    try {
      const backups = await this.backupManager.listBackups(this.configPath);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAge);
      
      let deletedCount = 0;
      let keptCount = 0;
      
      // Keep the most recent backups, delete old ones
      for (let i = 0; i < backups.length; i++) {
        const backup = backups[i];
        const backupDate = new Date(backup.timestamp);
        
        // Keep recent backups or if we haven't reached the keep limit
        if (i < keepBackups && backupDate > cutoffDate) {
          keptCount++;
        } else {
          try {
            await this.backupManager.deleteBackup(backup.backupPath);
            deletedCount++;
          } catch (error) {
            console.warn(`Could not delete backup ${backup.backupPath}: ${error.message}`);
          }
        }
      }
      
      // Clean up operation history
      const oldOperationCount = this.operationHistory.length;
      this.operationHistory = this.operationHistory.slice(-10); // Keep last 10 operations
      
      return {
        backupsDeleted: deletedCount,
        backupsKept: keptCount,
        operationsCleanedUp: oldOperationCount - this.operationHistory.length
      };
      
    } catch (error) {
      throw new Error(`Failed to cleanup backups: ${error.message}`);
    }
  }

  /**
   * Create default configuration structure
   * @returns {Object} Default configuration object
   */
  createDefaultConfiguration() {
    return {
      version: '1.0',
      scheduler: {
        timezone: 'UTC',
        outputDir: '/var/analytics/data'
      },
      sites: [],
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
  }
}

module.exports = {
  ConfigurationManager,
  BackupManager
};