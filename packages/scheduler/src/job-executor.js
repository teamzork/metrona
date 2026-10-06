/**
 * @fileoverview Job executor for analytics processing tasks
 * Feature: metrona-analytics-system, Requirements 2.1, 2.2, 2.4, 2.5, 10.1, 10.2, 10.4
 */

const path = require('path');
const fs = require('fs').promises;
const { LogFileReader } = require('../../parser/src/utils/log-file-reader');
const yaml = require('js-yaml');
const { NginxLogParser } = require('../../parser/src/parsers/nginx');
const { CaddyLogParser } = require('../../parser/src/parsers/caddy');
const { isLikelyBot } = require('../../parser/src/utils/bot-filter');
const { writeDashboardFile } = require('../../parser/src/utils/dashboard-export');
const { AnalyticsCalculator } = require('../../parser/src/utils/analytics-calculator');
const { YamlDatasetWriter } = require('../../parser/src/utils/yaml-writer');

/**
 * Job executor that handles analytics processing tasks
 */
class JobExecutor {
  /**
   * @param {Object} [options] - Configuration options
   * @param {string} [options.outputDir='./analytics'] - Output directory for YAML files
   * @param {string} [options.timezone='UTC'] - Timezone for analytics processing
   * @param {string} [options.salt=''] - Salt for visitor hashing
   * @param {string} [options.dashboardDataDir] - Where the dashboard reads `<siteId>.yaml` (defaults to outputDir)
   */
  constructor(options = {}) {
    this.outputDir = options.outputDir || './analytics';
    this.timezone = options.timezone || 'UTC';
    this.salt = options.salt || '';
    this.dashboardDataDir = options.dashboardDataDir || this.outputDir;
    
    // Initialize parser and writer
    this.logParser = new NginxLogParser('combined'); // Use combined format as default
    this.yamlWriter = new YamlDatasetWriter({
      outputDir: this.outputDir,
      filePrefix: 'analytics'
    });
    
    // Track processing state
    this.lastProcessedPositions = new Map(); // siteId -> position
    this.processingStats = {
      totalSitesProcessed: 0,
      totalLogEntriesProcessed: 0,
      totalErrors: 0,
      lastProcessingTime: null
    };
  }

  /**
   * Create a job function for processing a specific site's analytics
   * @param {Object} siteConfig - Site configuration
   * @param {string} siteConfig.siteId - Unique site identifier
   * @param {string} siteConfig.siteName - Human-readable site name
   * @param {string} siteConfig.domain - Site domain
   * @param {string} siteConfig.logPath - Path to nginx log file
   * @param {string} [siteConfig.timezone] - Site timezone (defaults to system timezone)
   * @param {Object} [siteConfig.parserOptions] - Additional parser options
   * @param {string} [siteConfig.format='nginx'] - Log format: 'nginx' (combined) or 'caddy' (JSON)
   * @param {string[]} [siteConfig.aliases] - Other hostnames of the site, never counted as referrers
   * @returns {Function} Job function that can be scheduled
   */
  createSiteProcessingJob(siteConfig) {
    // Validate site configuration
    this.validateSiteConfig(siteConfig);
    
    // Return the job function with comprehensive error handling
    return async (context = {}) => {
      const startTime = new Date();
      const siteId = siteConfig.siteId;
      
      try {
        // Pre-flight checks (Requirement 10.1)
        await this.performPreflightChecks(siteConfig);
        
        // Get last processed position for incremental processing
        const lastPosition = this.lastProcessedPositions.get(siteId) || 0;
        
        const parser = this.createParser(siteConfig);
        
        // Create log file reader for incremental processing with error isolation
        let logReader;
        try {
          logReader = new LogFileReader(siteConfig.logPath, {
            lastPosition: lastPosition,
            maxMemoryMB: context.maxMemoryMB || 100,
            rotationNaming: siteConfig.format === 'caddy' ? 'caddy' : 'suffix'
          });
        } catch (readerError) {
          throw new Error(`Failed to initialize log reader for ${siteId}: ${readerError.message}`);
        }
        
        // Create analytics calculator with error isolation
        let calculator;
        try {
          calculator = new AnalyticsCalculator({
            timezone: siteConfig.timezone || this.timezone,
            salt: this.salt,
            contentRankingOptions: siteConfig.parserOptions?.contentRanking,
            ownDomains: [siteConfig.domain, ...(siteConfig.aliases || [])]
          });
        } catch (calculatorError) {
          throw new Error(`Failed to initialize analytics calculator for ${siteId}: ${calculatorError.message}`);
        }
        
        let totalEntriesProcessed = 0;
        let currentPosition = lastPosition;
        let processingErrors = [];
        
        // Process log entries in batches with error isolation (Requirement 10.4)
        try {
          for await (const batch of logReader.streamBatches(
            (line) => this.parseLineWithErrorHandling(line, siteId, processingErrors, parser), 
            context.batchSize || 1000
          )) {
            if (batch.length > 0) {
              // Filter out failed parsing results; only pageviews by people reach the calculator
              const validEntries = batch.filter(entry => entry !== null);
              const pageviews = validEntries.filter(entry => parser.isPageview(entry) && !isLikelyBot(entry.userAgent));
              
              if (pageviews.length > 0) {
                calculator.processBatch(pageviews);
              }
              totalEntriesProcessed += validEntries.length;
            }
          }
        } catch (streamError) {
          // Log streaming error but continue with what we have (Requirement 10.1)
          this.logProcessingError(siteId, 'stream_processing', streamError, {
            entriesProcessedSoFar: totalEntriesProcessed,
            lastPosition: currentPosition
          });
          
          // If we processed some entries, continue with analytics generation
          if (totalEntriesProcessed === 0) {
            throw new Error(`No log entries could be processed for ${siteId}: ${streamError.message}`);
          }
        }
        
        // Generate analytics data with error handling
        let analytics;
        try {
          analytics = {
            summary: calculator.generateSummaryStatistics(),
            timeSeries: {
              hourly: calculator.generateTimeSeriesData('hourly'),
              daily: calculator.generateTimeSeriesData('daily'),
              monthly: calculator.generateTimeSeriesData('monthly')
            },
            topContent: calculator.generateTopContentData(
              siteConfig.parserOptions?.topContentLimit || 20
            ),
            referrers: calculator.generateReferrerData(
              siteConfig.parserOptions?.referrerLimit || 10
            )
          };
        } catch (analyticsError) {
          throw new Error(`Failed to generate analytics for ${siteId}: ${analyticsError.message}`);
        }
        
        // Write or update YAML dataset with data preservation (Requirement 10.2)
        let outputPath;
        try {
          // One dataset file per site (not per day), so time-series history accumulates across runs.
          outputPath = await this.yamlWriter.updateDataset(analytics, siteConfig, `${this.yamlWriter.filePrefix}-${siteId}.yaml`);
          const dataset = yaml.load(await fs.readFile(outputPath, 'utf8'));
          await writeDashboardFile(dataset, this.dashboardDataDir, siteId);
        } catch (yamlError) {
          // YAML generation failed - preserve existing data and report error (Requirement 10.2)
          this.logProcessingError(siteId, 'yaml_generation', yamlError, {
            analyticsGenerated: true,
            entriesProcessed: totalEntriesProcessed,
            preservedExistingData: true
          });
          
          throw new Error(`YAML generation failed for ${siteId}, existing data preserved: ${yamlError.message}`);
        }
        
        // Update processing state only on successful completion
        this.lastProcessedPositions.set(siteId, currentPosition);
        
        // Update statistics
        this.processingStats.totalSitesProcessed++;
        this.processingStats.totalLogEntriesProcessed += totalEntriesProcessed;
        this.processingStats.lastProcessingTime = new Date();
        
        const duration = new Date().getTime() - startTime.getTime();
        
        // Log processing warnings if any
        if (processingErrors.length > 0) {
          this.logProcessingWarnings(siteId, processingErrors, totalEntriesProcessed);
        }
        
        return {
          success: true,
          siteId,
          entriesProcessed: totalEntriesProcessed,
          processingErrors: processingErrors.length,
          outputPath,
          duration,
          analytics: {
            totalPageviews: analytics.summary.totalPageviews,
            uniqueVisitors: analytics.summary.uniqueVisitors,
            totalPages: analytics.summary.totalPages
          }
        };
        
      } catch (error) {
        this.processingStats.totalErrors++;
        
        const duration = new Date().getTime() - startTime.getTime();
        
        // Log detailed error for troubleshooting (Requirement 2.5)
        this.logProcessingError(siteId, 'job_execution', error, {
          duration,
          context: this.sanitizeContext(context)
        });
        
        // Re-throw with additional context but preserve error isolation (Requirement 10.4)
        const enhancedError = new Error(
          `Failed to process analytics for site ${siteId}: ${error.message}`
        );
        enhancedError.originalError = error;
        enhancedError.siteId = siteId;
        enhancedError.duration = duration;
        enhancedError.category = this.categorizeProcessingError(error);
        
        throw enhancedError;
      }
    };
  }

  /**
   * Create a job function for cleaning up old backup files
   * @param {Object} [options] - Cleanup options
   * @param {number} [options.maxAge=7] - Maximum age in days for backup files
   * @returns {Function} Cleanup job function
   */
  createCleanupJob(options = {}) {
    const maxAge = options.maxAge || 7;
    
    return async (context = {}) => {
      try {
        const cleanedCount = await this.yamlWriter.cleanupBackups(maxAge);
        
        return {
          success: true,
          cleanedFiles: cleanedCount,
          maxAge
        };
        
      } catch (error) {
        throw new Error(`Backup cleanup failed: ${error.message}`);
      }
    };
  }

  /**
   * Create a job function for health checks
   * @param {Array<Object>} siteConfigs - Array of site configurations to check
   * @returns {Function} Health check job function
   */
  createHealthCheckJob(siteConfigs) {
    return async (context = {}) => {
      const results = {
        timestamp: new Date(),
        totalSites: siteConfigs.length,
        healthySites: 0,
        unhealthySites: 0,
        sites: []
      };
      
      for (const siteConfig of siteConfigs) {
        try {
          // Check if log file exists and is readable
          await fs.access(siteConfig.logPath, fs.constants.R_OK);
          
          // Check if output directory is writable
          await fs.access(this.outputDir, fs.constants.W_OK);
          
          // Get file stats
          const stats = await fs.stat(siteConfig.logPath);
          
          results.sites.push({
            siteId: siteConfig.siteId,
            status: 'healthy',
            logPath: siteConfig.logPath,
            logSize: stats.size,
            logModified: stats.mtime,
            lastProcessed: this.lastProcessedPositions.get(siteConfig.siteId) || 0
          });
          
          results.healthySites++;
          
        } catch (error) {
          results.sites.push({
            siteId: siteConfig.siteId,
            status: 'unhealthy',
            error: error.message,
            logPath: siteConfig.logPath
          });
          
          results.unhealthySites++;
        }
      }
      
      return results;
    };
  }

  /**
   * Get processing statistics
   * @returns {Object} Processing statistics
   */
  getStats() {
    return {
      ...this.processingStats,
      activeSites: this.lastProcessedPositions.size,
      lastProcessedPositions: Object.fromEntries(this.lastProcessedPositions)
    };
  }

  /**
   * Reset processing position for a site (force full reprocessing)
   * @param {string} siteId - Site identifier
   * @returns {boolean} True if position was reset
   */
  resetSitePosition(siteId) {
    if (this.lastProcessedPositions.has(siteId)) {
      this.lastProcessedPositions.set(siteId, 0);
      return true;
    }
    return false;
  }

  /**
   * Set processing position for a site
   * @param {string} siteId - Site identifier
   * @param {number} position - File position
   * @returns {void}
   */
  setSitePosition(siteId, position) {
    this.lastProcessedPositions.set(siteId, position);
  }

  /**
   * The parser for a site's log format, with its options.
   * @param {Object} siteConfig - Site configuration
   * @returns {import('../../parser/src/parsers/base')} Parser instance
   * @private
   */
  createParser(siteConfig) {
    const opts = siteConfig.parserOptions || {};
    if (siteConfig.format === 'caddy') {
      return new CaddyLogParser(siteConfig.logPath, 0, {
        clientIpHeader: opts.clientIpHeader,
        collapsePrefixes: opts.collapsePrefixes,
        hosts: opts.hosts
      });
    }
    return new NginxLogParser(siteConfig.logPath, 0, opts.nginxFormat || 'combined');
  }

  /**
   * Validate site configuration
   * @param {Object} siteConfig - Site configuration to validate
   * @throws {Error} If configuration is invalid
   * @private
   */
  validateSiteConfig(siteConfig) {
    if (!siteConfig || typeof siteConfig !== 'object') {
      throw new Error('Site configuration must be an object');
    }
    
    if (!siteConfig.siteId || typeof siteConfig.siteId !== 'string') {
      throw new Error('Site configuration must have a valid siteId string');
    }
    
    if (!siteConfig.siteName || typeof siteConfig.siteName !== 'string') {
      throw new Error('Site configuration must have a valid siteName string');
    }
    
    if (!siteConfig.domain || typeof siteConfig.domain !== 'string') {
      throw new Error('Site configuration must have a valid domain string');
    }
    
    if (!siteConfig.logPath || typeof siteConfig.logPath !== 'string') {
      throw new Error('Site configuration must have a valid logPath string');
    }
    
    if (siteConfig.format !== undefined && !['nginx', 'caddy'].includes(siteConfig.format)) {
      throw new Error(`Unsupported log format: ${siteConfig.format} (use 'nginx' or 'caddy')`);
    }
    
    // Validate domain format (basic check)
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
    if (!domainRegex.test(siteConfig.domain)) {
      throw new Error(`Invalid domain format: ${siteConfig.domain}`);
    }
    
    // Validate log path format (basic check)
    if (!path.isAbsolute(siteConfig.logPath) && !siteConfig.logPath.startsWith('./')) {
      console.warn(`Log path should be absolute or relative: ${siteConfig.logPath}`);
    }
  }

  /**
   * Perform pre-flight checks before processing a site (Requirement 10.1)
   * @param {Object} siteConfig - Site configuration
   * @returns {Promise<void>}
   * @throws {Error} If pre-flight checks fail
   * @private
   */
  async performPreflightChecks(siteConfig) {
    const siteId = siteConfig.siteId;
    
    try {
      // Check if log file exists and is readable
      await fs.access(siteConfig.logPath, fs.constants.R_OK);
      
      // Check file stats
      const stats = await fs.stat(siteConfig.logPath);
      
      // Warn if log file is very old (might indicate rotation issues)
      const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
      if (ageHours > 48) {
        console.warn(`[${siteId}] Log file is ${Math.round(ageHours)} hours old, check log rotation`);
      }
      
      // Check if output directory is writable
      await fs.access(this.outputDir, fs.constants.W_OK);
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Log file not found: ${siteConfig.logPath}`);
      } else if (error.code === 'EACCES') {
        throw new Error(`Permission denied accessing: ${siteConfig.logPath}`);
      } else {
        throw new Error(`Pre-flight check failed: ${error.message}`);
      }
    }
  }

  /**
   * Parse a log line with error handling and isolation (Requirement 10.1)
   * @param {string} line - Log line to parse
   * @param {string} siteId - Site identifier for error context
   * @param {Array} processingErrors - Array to collect parsing errors
   * @returns {Object|null} Parsed log entry or null if parsing failed
   * @private
   */
  parseLineWithErrorHandling(line, siteId, processingErrors, parser = this.logParser) {
    try {
      const result = parser.parseLine(line);
      
      // If parser returns null, it means the line was invalid but not an error
      // This is normal behavior for malformed log lines
      if (result === null) {
        // Count as a processing warning, not an error
        processingErrors.push({
          line: line.substring(0, 100) + (line.length > 100 ? '...' : ''),
          error: 'Invalid log line format - skipped',
          timestamp: new Date(),
          severity: 'warning'
        });
      }
      
      return result;
    } catch (parseError) {
      // Collect actual parsing errors (exceptions)
      processingErrors.push({
        line: line.substring(0, 100) + (line.length > 100 ? '...' : ''),
        error: parseError.message,
        timestamp: new Date(),
        severity: 'error'
      });
      
      // Return null to indicate failed parsing
      return null;
    }
  }

  /**
   * Log processing errors with structured information (Requirement 2.5)
   * @param {string} siteId - Site identifier
   * @param {string} errorType - Type of error
   * @param {Error} error - Error object
   * @param {Object} context - Additional context
   * @private
   */
  logProcessingError(siteId, errorType, error, context = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      component: 'JobExecutor',
      siteId,
      errorType,
      message: error instanceof Error ? error.message : String(error),
      context
    };
    
    // Include stack trace for debugging
    if (error instanceof Error && error.stack) {
      logEntry.stackTrace = error.stack;
    }
    
    // Log to console with structured format
    console.error(`[${logEntry.timestamp}] ${logEntry.level} ${logEntry.component}: Site ${siteId} - ${errorType}`);
    console.error(`  Message: ${logEntry.message}`);
    
    if (Object.keys(context).length > 0) {
      console.error(`  Context: ${JSON.stringify(context, null, 2)}`);
    }
    
    if (logEntry.stackTrace && process.env.NODE_ENV !== 'production') {
      console.error(`  Stack: ${logEntry.stackTrace}`);
    }
  }

  /**
   * Log processing warnings for non-fatal issues
   * @param {string} siteId - Site identifier
   * @param {Array} processingErrors - Array of processing errors
   * @param {number} totalProcessed - Total entries processed successfully
   * @private
   */
  logProcessingWarnings(siteId, processingErrors, totalProcessed) {
    const errorCount = processingErrors.length;
    const errorRate = totalProcessed > 0 ? (errorCount / (totalProcessed + errorCount) * 100).toFixed(2) : '100.00';
    
    console.warn(`[${new Date().toISOString()}] WARN JobExecutor: Site ${siteId} had ${errorCount} parsing errors (${errorRate}% error rate)`);
    
    // Log sample errors for debugging
    const sampleErrors = processingErrors.slice(0, 3);
    sampleErrors.forEach((error, index) => {
      console.warn(`  Sample error ${index + 1}: ${error.error}`);
      console.warn(`    Line: ${error.line}`);
    });
    
    if (processingErrors.length > 3) {
      console.warn(`  ... and ${processingErrors.length - 3} more errors`);
    }
  }

  /**
   * Categorize processing errors for better handling
   * @param {Error} error - Error to categorize
   * @returns {string} Error category
   * @private
   */
  categorizeProcessingError(error) {
    if (!error) return 'unknown';
    
    const message = error.message || String(error);
    
    if (message.includes('Log file not found') || message.includes('ENOENT')) {
      return 'file_not_found';
    }
    if (message.includes('Permission denied') || message.includes('EACCES')) {
      return 'permission_denied';
    }
    if (message.includes('YAML generation failed')) {
      return 'yaml_generation_error';
    }
    if (message.includes('Failed to initialize')) {
      return 'initialization_error';
    }
    if (message.includes('No log entries could be processed')) {
      return 'no_processable_data';
    }
    if (message.includes('Failed to generate analytics')) {
      return 'analytics_calculation_error';
    }
    
    return 'processing_error';
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
    if (context.maxMemoryMB) sanitized.maxMemoryMB = context.maxMemoryMB;
    
    return sanitized;
  }
}

module.exports = {
  JobExecutor
};