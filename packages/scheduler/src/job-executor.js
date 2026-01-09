/**
 * @fileoverview Job executor for analytics processing tasks
 * Feature: metrona-analytics-system, Requirements 2.1, 2.2, 2.4, 2.5
 */

const path = require('path');
const fs = require('fs').promises;
const { LogFileReader } = require('../../parser/src/utils/log-file-reader');
const { NginxLogParser } = require('../../parser/src/parsers/nginx');
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
   */
  constructor(options = {}) {
    this.outputDir = options.outputDir || './analytics';
    this.timezone = options.timezone || 'UTC';
    this.salt = options.salt || '';
    
    // Initialize parser and writer
    this.logParser = new NginxLogParser();
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
   * @returns {Function} Job function that can be scheduled
   */
  createSiteProcessingJob(siteConfig) {
    // Validate site configuration
    this.validateSiteConfig(siteConfig);
    
    // Return the job function
    return async (context = {}) => {
      const startTime = new Date();
      const siteId = siteConfig.siteId;
      
      try {
        // Get last processed position for incremental processing
        const lastPosition = this.lastProcessedPositions.get(siteId) || 0;
        
        // Create log file reader for incremental processing
        const logReader = new LogFileReader(siteConfig.logPath, {
          startPosition: lastPosition,
          batchSize: context.batchSize || 1000
        });
        
        // Create analytics calculator
        const calculator = new AnalyticsCalculator({
          timezone: siteConfig.timezone || this.timezone,
          salt: this.salt,
          contentRankingOptions: siteConfig.parserOptions?.contentRanking
        });
        
        let totalEntriesProcessed = 0;
        let currentPosition = lastPosition;
        
        // Process log entries in batches
        for await (const batch of logReader.streamBatches((line) => this.logParser.parseLine(line), context.batchSize || 1000)) {
          if (batch.length > 0) {
            calculator.processBatch(batch);
            totalEntriesProcessed += batch.length;
          }
        }
        
        // Generate analytics data
        const analytics = {
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
        
        // Write or update YAML dataset
        const outputPath = await this.yamlWriter.updateDataset(analytics, siteConfig);
        
        // Update processing state (simplified for now)
        // TODO: Implement proper position tracking with LogFileReader
        this.lastProcessedPositions.set(siteId, currentPosition);
        
        // Update statistics
        this.processingStats.totalSitesProcessed++;
        this.processingStats.totalLogEntriesProcessed += totalEntriesProcessed;
        this.processingStats.lastProcessingTime = new Date();
        
        const duration = new Date() - startTime;
        
        return {
          success: true,
          siteId,
          entriesProcessed: totalEntriesProcessed,
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
        
        const duration = new Date() - startTime;
        
        // Re-throw with additional context
        const enhancedError = new Error(
          `Failed to process analytics for site ${siteId}: ${error.message}`
        );
        enhancedError.originalError = error;
        enhancedError.siteId = siteId;
        enhancedError.duration = duration;
        
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
}

module.exports = {
  JobExecutor
};