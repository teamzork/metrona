/**
 * @fileoverview YAML dataset writer for structured analytics output
 * Feature: metrona-analytics-system, Requirements 2.4, 7.1, 7.6, 9.6
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

/**
 * YAML dataset writer for generating structured analytics output files
 */
class YamlDatasetWriter {
  /**
   * @param {Object} [options] - Configuration options
   * @param {string} [options.outputDir='./analytics'] - Output directory for YAML files
   * @param {string} [options.filePrefix='analytics'] - Prefix for output files
   * @param {boolean} [options.prettyFormat=true] - Whether to format YAML for readability
   * @param {boolean} [options.createBackups=true] - Whether to create backup files before updates
   */
  constructor(options = {}) {
    this.outputDir = options.outputDir || './analytics';
    this.filePrefix = options.filePrefix || 'analytics';
    this.prettyFormat = options.prettyFormat !== false;
    this.createBackups = options.createBackups !== false;
    
    // YAML formatting options
    this.yamlOptions = {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
      flowLevel: -1
    };
  }

  /**
   * Write complete analytics dataset to YAML file
   * @param {Object} analyticsData - Complete analytics dataset from AnalyticsCalculator
   * @param {Object} siteConfig - Site configuration with identification
   * @param {string} [siteConfig.siteId] - Unique site identifier
   * @param {string} [siteConfig.siteName] - Human-readable site name
   * @param {string} [siteConfig.domain] - Site domain
   * @param {string} [filename] - Custom filename (optional)
   * @returns {Promise<string>} Path to written file
   */
  async writeDataset(analyticsData, siteConfig = {}, filename = null) {
    // Ensure output directory exists
    await this.ensureOutputDirectory();

    // Generate filename if not provided
    const outputFilename = filename || this.generateFilename(siteConfig.siteId);
    const outputPath = path.join(this.outputDir, outputFilename);

    // Create structured dataset with metadata
    const dataset = this.createStructuredDataset(analyticsData, siteConfig);

    // Create backup if file exists and backups are enabled
    if (this.createBackups && await this.fileExists(outputPath)) {
      await this.createBackupFile(outputPath);
    }

    // Write YAML file
    const yamlContent = yaml.dump(dataset, this.yamlOptions);
    await fs.writeFile(outputPath, yamlContent, 'utf8');

    return outputPath;
  }

  /**
   * Perform incremental update to existing YAML dataset
   * @param {Object} newData - New analytics data to merge
   * @param {Object} siteConfig - Site configuration
   * @param {string} [filename] - Target filename (optional)
   * @returns {Promise<string>} Path to updated file
   */
  async updateDataset(newData, siteConfig = {}, filename = null) {
    // Ensure output directory exists
    await this.ensureOutputDirectory();
    
    const outputFilename = filename || this.generateFilename(siteConfig.siteId);
    const outputPath = path.join(this.outputDir, outputFilename);

    let existingDataset = null;

    // Load existing dataset if it exists
    if (await this.fileExists(outputPath)) {
      try {
        const existingContent = await fs.readFile(outputPath, 'utf8');
        existingDataset = yaml.load(existingContent);
      } catch (error) {
        // If existing file is corrupted, treat as new dataset
        console.warn(`Warning: Could not load existing dataset ${outputPath}, creating new one:`, error.message);
        existingDataset = null;
      }
    }

    // Merge data incrementally
    const mergedData = existingDataset ? 
      this.mergeDatasets(existingDataset, newData, siteConfig) :
      this.createStructuredDataset(newData, siteConfig);

    // Create backup before update
    if (this.createBackups && existingDataset) {
      await this.createBackupFile(outputPath);
    }

    // Write updated dataset
    const yamlContent = yaml.dump(mergedData, this.yamlOptions);
    await fs.writeFile(outputPath, yamlContent, 'utf8');

    return outputPath;
  }

  /**
   * Write time-series data only (for incremental updates)
   * @param {Object} timeSeriesData - Time-series analytics data
   * @param {Object} siteConfig - Site configuration
   * @param {string} [period='daily'] - Time period (hourly, daily, monthly)
   * @returns {Promise<string>} Path to written file
   */
  async writeTimeSeriesData(timeSeriesData, siteConfig = {}, period = 'daily') {
    await this.ensureOutputDirectory();

    const filename = `${this.filePrefix}-${siteConfig.siteId || 'default'}-timeseries-${period}.yaml`;
    const outputPath = path.join(this.outputDir, filename);

    const dataset = {
      metadata: this.createMetadata(siteConfig),
      timeSeries: {
        period: timeSeriesData.groupBy || period,
        timezone: timeSeriesData.timezone || 'UTC',
        totalPageviews: timeSeriesData.totalPageviews || 0,
        uniqueVisitors: timeSeriesData.uniqueVisitors || 0,
        buckets: timeSeriesData.buckets || []
      }
    };

    const yamlContent = yaml.dump(dataset, this.yamlOptions);
    await fs.writeFile(outputPath, yamlContent, 'utf8');

    return outputPath;
  }

  /**
   * Create structured dataset with consistent schema
   * @param {Object} analyticsData - Raw analytics data
   * @param {Object} siteConfig - Site configuration
   * @returns {Object} Structured dataset
   * @private
   */
  createStructuredDataset(analyticsData, siteConfig) {
    const metadata = this.createMetadata(siteConfig);

    return {
      // Metadata section (Requirements 7.6)
      metadata,

      // Summary statistics (Requirements 7.5)
      summary: {
        totalPageviews: analyticsData.summary?.totalPageviews || 0,
        uniqueVisitors: analyticsData.summary?.uniqueVisitors || 0,
        totalPages: analyticsData.summary?.totalPages || 0,
        totalReferrerDomains: analyticsData.summary?.totalReferrerDomains || 0,
        avgPageviewsPerSession: analyticsData.summary?.avgPageviewsPerSession || 0,
        peakTrafficDay: analyticsData.summary?.peakTrafficDay || null,
        peakTrafficPageviews: analyticsData.summary?.peakTrafficPageviews || 0,
        directTraffic: analyticsData.summary?.directTraffic || 0,
        referralTraffic: analyticsData.summary?.referralTraffic || 0,
        dataRange: analyticsData.summary?.dataRange || { start: null, end: null }
      },

      // Time-series data (Requirements 7.2)
      timeSeries: this.createTimeSeriesSection(analyticsData.timeSeries),

      // Top content data (Requirements 7.3)
      topContent: {
        totalPages: analyticsData.topContent?.totalPages || 0,
        totalPageviews: analyticsData.topContent?.totalPageviews || 0,
        uniqueVisitors: analyticsData.topContent?.uniqueVisitors || 0,
        pages: (analyticsData.topContent?.topPages || []).map(page => ({
          path: page.path,
          pageviews: page.pageviews,
          uniqueVisitors: page.uniqueVisitors,
          percentage: page.percentage,
          bytes: page.bytes || 0,
          avgBytesPerView: page.avgBytesPerView || 0,
          firstSeen: page.firstSeen,
          lastSeen: page.lastSeen
        }))
      },

      // Referrer data (Requirements 7.4)
      referrers: {
        totalReferrerDomains: analyticsData.referrers?.totalReferrerDomains || 0,
        totalReferrals: analyticsData.referrers?.totalReferrals || 0,
        directTraffic: analyticsData.referrers?.directTraffic || 0,
        domains: (analyticsData.referrers?.topReferrers || []).map(ref => ({
          domain: ref.domain,
          totalReferrals: ref.totalReferrals,
          percentage: ref.percentage,
          topPaths: ref.topPaths || []
        }))
      }
    };
  }

  /**
   * Create metadata section with generation timestamp and site identification
   * @param {Object} siteConfig - Site configuration
   * @returns {Object} Metadata object
   * @private
   */
  createMetadata(siteConfig) {
    return {
      // Generation information (Requirements 7.6)
      generatedAt: new Date().toISOString(),
      generatedBy: 'Metrona Analytics System',
      version: '1.0.0',
      
      // Site identification (Requirements 7.6)
      site: {
        id: siteConfig.siteId || 'default',
        name: siteConfig.siteName || 'Default Site',
        domain: siteConfig.domain || 'localhost',
        timezone: siteConfig.timezone || 'UTC'
      },

      // Schema information
      schema: {
        version: '1.0',
        format: 'yaml',
        description: 'Metrona Analytics Dataset'
      }
    };
  }

  /**
   * Create time-series section with only existing periods
   * @param {Object} timeSeriesData - Raw time-series data
   * @returns {Object} Time-series section
   * @private
   */
  createTimeSeriesSection(timeSeriesData) {
    const timeSeries = {};
    
    if (timeSeriesData) {
      // Only include periods that exist in the input data
      ['hourly', 'daily', 'monthly'].forEach(period => {
        if (timeSeriesData[period]) {
          timeSeries[period] = this.normalizeTimeSeriesData(timeSeriesData[period]);
        }
      });
    }
    
    // If no time-series data exists, create empty structure with at least daily
    if (Object.keys(timeSeries).length === 0) {
      timeSeries.daily = this.normalizeTimeSeriesData(null);
    }
    
    return timeSeries;
  }

  /**
   * Normalize time-series data structure
   * @param {Object} timeSeriesData - Raw time-series data
   * @returns {Object} Normalized time-series data
   * @private
   */
  normalizeTimeSeriesData(timeSeriesData) {
    if (!timeSeriesData) {
      return {
        groupBy: 'daily',
        timezone: 'UTC',
        totalPageviews: 0,
        uniqueVisitors: 0,
        buckets: []
      };
    }

    return {
      groupBy: timeSeriesData.groupBy || 'daily',
      timezone: timeSeriesData.timezone || 'UTC',
      totalPageviews: timeSeriesData.totalPageviews || 0,
      uniqueVisitors: timeSeriesData.uniqueVisitors || 0,
      buckets: (timeSeriesData.buckets || []).map(bucket => ({
        timestamp: bucket.timestamp,
        pageviews: bucket.pageviews || 0,
        uniqueVisitors: bucket.uniqueVisitors || 0
      }))
    };
  }

  /**
   * Merge existing dataset with new data (Requirements 9.6)
   * @param {Object} existingDataset - Existing dataset
   * @param {Object} newData - New analytics data
   * @param {Object} siteConfig - Site configuration
   * @returns {Object} Merged dataset
   * @private
   */
  mergeDatasets(existingDataset, newData, siteConfig) {
    // Create new dataset structure
    const mergedDataset = this.createStructuredDataset(newData, siteConfig);

    // Preserve historical data where appropriate
    if (existingDataset.timeSeries) {
      // Merge time-series data by combining buckets and removing duplicates
      ['hourly', 'daily', 'monthly'].forEach(period => {
        if (existingDataset.timeSeries[period]) {
          if (mergedDataset.timeSeries[period]) {
            // Both exist - merge them
            mergedDataset.timeSeries[period] = this.mergeTimeSeriesPeriod(
              existingDataset.timeSeries[period],
              mergedDataset.timeSeries[period]
            );
          } else {
            // Only exists in existing dataset - preserve it
            mergedDataset.timeSeries[period] = existingDataset.timeSeries[period];
          }
        }
      });
    }

    // Update metadata with merge information
    mergedDataset.metadata.lastUpdated = mergedDataset.metadata.generatedAt;
    mergedDataset.metadata.previousUpdate = existingDataset.metadata?.generatedAt || null;

    return mergedDataset;
  }

  /**
   * Merge time-series data for a specific period
   * @param {Object} existing - Existing time-series data
   * @param {Object} newData - New time-series data
   * @returns {Object} Merged time-series data
   * @private
   */
  mergeTimeSeriesPeriod(existing, newData) {
    // Create map of existing buckets by timestamp
    const existingBuckets = new Map();
    (existing.buckets || []).forEach(bucket => {
      existingBuckets.set(bucket.timestamp, bucket);
    });

    // Merge new buckets, replacing existing ones with same timestamp
    (newData.buckets || []).forEach(bucket => {
      existingBuckets.set(bucket.timestamp, bucket);
    });

    // Convert back to array and sort by timestamp
    const mergedBuckets = Array.from(existingBuckets.values())
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return {
      groupBy: newData.groupBy,
      timezone: newData.timezone,
      totalPageviews: newData.totalPageviews,
      uniqueVisitors: newData.uniqueVisitors,
      buckets: mergedBuckets
    };
  }

  /**
   * Generate filename for dataset
   * @param {string} [siteId='default'] - Site identifier
   * @returns {string} Generated filename
   * @private
   */
  generateFilename(siteId = 'default') {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `${this.filePrefix}-${siteId}-${timestamp}.yaml`;
  }

  /**
   * Ensure output directory exists
   * @returns {Promise<void>}
   * @private
   */
  async ensureOutputDirectory() {
    try {
      await fs.access(this.outputDir);
    } catch (error) {
      // Directory doesn't exist, create it
      await fs.mkdir(this.outputDir, { recursive: true });
    }
  }

  /**
   * Check if file exists
   * @param {string} filePath - Path to check
   * @returns {Promise<boolean>} True if file exists
   * @private
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create backup of existing file
   * @param {string} filePath - Path to backup
   * @returns {Promise<void>}
   * @private
   */
  async createBackupFile(filePath) {
    const backupPath = `${filePath}.backup.${Date.now()}`;
    try {
      await fs.copyFile(filePath, backupPath);
    } catch (error) {
      console.warn(`Warning: Could not create backup of ${filePath}:`, error.message);
    }
  }

  /**
   * Read existing dataset from file
   * @param {string} [filename] - Filename to read (optional)
   * @param {string} [siteId] - Site ID for default filename generation
   * @returns {Promise<Object|null>} Parsed dataset or null if not found
   */
  async readDataset(filename = null, siteId = 'default') {
    const targetFilename = filename || this.generateFilename(siteId);
    const filePath = path.join(this.outputDir, targetFilename);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      return yaml.load(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // File not found
      }
      throw error; // Re-throw other errors
    }
  }

  /**
   * List all dataset files in output directory
   * @returns {Promise<string[]>} Array of dataset filenames
   */
  async listDatasets() {
    try {
      const files = await fs.readdir(this.outputDir);
      return files.filter(file => 
        file.startsWith(this.filePrefix) && 
        (file.endsWith('.yaml') || file.endsWith('.yml'))
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        return []; // Directory doesn't exist
      }
      throw error;
    }
  }

  /**
   * Clean up old backup files
   * @param {number} [maxAge=7] - Maximum age in days
   * @returns {Promise<number>} Number of files cleaned up
   */
  async cleanupBackups(maxAge = 7) {
    const maxAgeMs = maxAge * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleanedCount = 0;

    try {
      const files = await fs.readdir(this.outputDir);
      const backupFiles = files.filter(file => file.includes('.backup.'));

      for (const file of backupFiles) {
        const filePath = path.join(this.outputDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAgeMs) {
          await fs.unlink(filePath);
          cleanedCount++;
        }
      }
    } catch (error) {
      console.warn('Warning: Could not clean up backup files:', error.message);
    }

    return cleanedCount;
  }
}

/**
 * Utility function to create a YAML dataset writer
 * @param {Object} [options] - Configuration options
 * @returns {YamlDatasetWriter} New YAML writer instance
 */
function createYamlWriter(options = {}) {
  return new YamlDatasetWriter(options);
}

/**
 * Utility function to write analytics dataset to YAML
 * @param {Object} analyticsData - Analytics data from AnalyticsCalculator
 * @param {Object} siteConfig - Site configuration
 * @param {Object} [options] - Writer options
 * @returns {Promise<string>} Path to written file
 */
async function writeAnalyticsDataset(analyticsData, siteConfig, options = {}) {
  const writer = new YamlDatasetWriter(options);
  return await writer.writeDataset(analyticsData, siteConfig);
}

module.exports = {
  YamlDatasetWriter,
  createYamlWriter,
  writeAnalyticsDataset
};