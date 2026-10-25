/**
 * @fileoverview Unit tests for YamlDatasetWriter
 * Feature: metrona-analytics-system, Requirements 2.4, 7.1, 7.6, 9.6
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { YamlDatasetWriter, createYamlWriter, writeAnalyticsDataset } = require('./yaml-writer');

describe('YamlDatasetWriter', () => {
  let writer;
  let testOutputDir;

  beforeEach(async () => {
    // Create temporary test directory
    testOutputDir = path.join(__dirname, 'test-output-' + Date.now());
    writer = new YamlDatasetWriter({
      outputDir: testOutputDir,
      filePrefix: 'test-analytics'
    });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      const files = await fs.readdir(testOutputDir);
      for (const file of files) {
        await fs.unlink(path.join(testOutputDir, file));
      }
      await fs.rmdir(testOutputDir);
    } catch (error) {
      // Directory might not exist or already cleaned up
    }
  });

  describe('constructor', () => {
    it('should create writer with default options', () => {
      const defaultWriter = new YamlDatasetWriter();
      
      expect(defaultWriter.outputDir).toBe('./analytics');
      expect(defaultWriter.filePrefix).toBe('analytics');
      expect(defaultWriter.prettyFormat).toBe(true);
      expect(defaultWriter.createBackups).toBe(true);
    });

    it('should create writer with custom options', () => {
      const customWriter = new YamlDatasetWriter({
        outputDir: '/custom/path',
        filePrefix: 'custom-analytics',
        prettyFormat: false,
        createBackups: false
      });
      
      expect(customWriter.outputDir).toBe('/custom/path');
      expect(customWriter.filePrefix).toBe('custom-analytics');
      expect(customWriter.prettyFormat).toBe(false);
      expect(customWriter.createBackups).toBe(false);
    });
  });

  describe('writeDataset', () => {
    it('should write complete analytics dataset to YAML file', async () => {
      const analyticsData = {
        summary: {
          totalPageviews: 100,
          uniqueVisitors: 50,
          totalPages: 10,
          avgPageviewsPerSession: 2.0,
          directTraffic: 30,
          referralTraffic: 70
        },
        timeSeries: {
          daily: {
            groupBy: 'daily',
            timezone: 'UTC',
            totalPageviews: 100,
            uniqueVisitors: 50,
            buckets: [
              { timestamp: '2026-01-08T00:00:00Z', pageviews: 50, uniqueVisitors: 25 },
              { timestamp: '2026-01-09T00:00:00Z', pageviews: 50, uniqueVisitors: 25 }
            ]
          }
        },
        topContent: {
          totalPages: 10,
          totalPageviews: 100,
          uniqueVisitors: 50,
          topPages: [
            { path: '/home', pageviews: 40, uniqueVisitors: 20, percentage: 40 },
            { path: '/about', pageviews: 30, uniqueVisitors: 15, percentage: 30 }
          ]
        },
        referrers: {
          totalReferrerDomains: 3,
          totalReferrals: 70,
          directTraffic: 30,
          topReferrers: [
            { domain: 'google.com', totalReferrals: 40, percentage: 57.14, topPaths: [] },
            { domain: 'facebook.com', totalReferrals: 30, percentage: 42.86, topPaths: [] }
          ]
        }
      };

      const siteConfig = {
        siteId: 'test-site',
        siteName: 'Test Site',
        domain: 'example.com'
      };

      const outputPath = await writer.writeDataset(analyticsData, siteConfig);

      // Verify file was created
      const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file content
      const content = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(content);

      expect(parsedData.metadata.site.id).toBe('test-site');
      expect(parsedData.metadata.site.name).toBe('Test Site');
      expect(parsedData.metadata.site.domain).toBe('example.com');
      expect(parsedData.summary.totalPageviews).toBe(100);
      expect(parsedData.summary.uniqueVisitors).toBe(50);
      expect(parsedData.timeSeries.daily.buckets).toHaveLength(2);
      expect(parsedData.topContent.pages).toHaveLength(2);
      expect(parsedData.referrers.domains).toHaveLength(2);
    });

    it('should create output directory if it does not exist', async () => {
      const nonExistentDir = path.join(__dirname, 'non-existent-' + Date.now());
      const writerWithNewDir = new YamlDatasetWriter({
        outputDir: nonExistentDir,
        filePrefix: 'test'
      });

      const analyticsData = { summary: { totalPageviews: 0 } };
      const siteConfig = { siteId: 'test' };

      const outputPath = await writerWithNewDir.writeDataset(analyticsData, siteConfig);

      // Verify directory and file were created
      const dirExists = await fs.access(nonExistentDir).then(() => true).catch(() => false);
      const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
      expect(dirExists).toBe(true);
      expect(fileExists).toBe(true);

      // Clean up
      await fs.unlink(outputPath);
      await fs.rmdir(nonExistentDir);
    });

    it('should handle empty analytics data gracefully', async () => {
      const emptyData = {};
      const siteConfig = { siteId: 'empty-test' };

      const outputPath = await writer.writeDataset(emptyData, siteConfig);
      const content = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(content);

      expect(parsedData.summary.totalPageviews).toBe(0);
      expect(parsedData.summary.uniqueVisitors).toBe(0);
      expect(parsedData.timeSeries.daily.buckets).toEqual([]);
      expect(parsedData.topContent.pages).toEqual([]);
      expect(parsedData.referrers.domains).toEqual([]);
    });
  });

  describe('updateDataset', () => {
    it('should create new dataset if none exists', async () => {
      const analyticsData = {
        summary: { totalPageviews: 50, uniqueVisitors: 25 }
      };
      const siteConfig = { siteId: 'update-test' };

      const outputPath = await writer.updateDataset(analyticsData, siteConfig);
      const content = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(content);

      expect(parsedData.summary.totalPageviews).toBe(50);
      expect(parsedData.summary.uniqueVisitors).toBe(25);
    });

    it('should merge with existing dataset', async () => {
      const siteConfig = { siteId: 'merge-test' };

      // Create initial dataset
      const initialData = {
        summary: { totalPageviews: 50, uniqueVisitors: 25 },
        timeSeries: {
          daily: {
            groupBy: 'daily',
            buckets: [
              { timestamp: '2026-01-08T00:00:00Z', pageviews: 50, uniqueVisitors: 25 }
            ]
          }
        }
      };

      await writer.writeDataset(initialData, siteConfig);

      // Update with new data
      const newData = {
        summary: { totalPageviews: 100, uniqueVisitors: 50 },
        timeSeries: {
          daily: {
            groupBy: 'daily',
            buckets: [
              { timestamp: '2026-01-08T00:00:00Z', pageviews: 60, uniqueVisitors: 30 }, // Updated
              { timestamp: '2026-01-09T00:00:00Z', pageviews: 40, uniqueVisitors: 20 }  // New
            ]
          }
        }
      };

      const outputPath = await writer.updateDataset(newData, siteConfig);
      const content = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(content);

      expect(parsedData.summary.totalPageviews).toBe(100);
      expect(parsedData.timeSeries.daily.buckets).toHaveLength(2);
      expect(parsedData.timeSeries.daily.buckets[0].pageviews).toBe(60); // Updated value
      expect(parsedData.timeSeries.daily.buckets[1].pageviews).toBe(40); // New value
    });

    it('should create backup before updating existing file', async () => {
      const siteConfig = { siteId: 'backup-test' };
      const initialData = { summary: { totalPageviews: 50 } };

      // Create initial file
      const outputPath = await writer.writeDataset(initialData, siteConfig);

      // Update the file
      const newData = { summary: { totalPageviews: 100 } };
      await writer.updateDataset(newData, siteConfig);

      // Check that backup was created
      const files = await fs.readdir(testOutputDir);
      const backupFiles = files.filter(file => file.includes('.backup.'));
      expect(backupFiles.length).toBeGreaterThan(0);
    });
  });

  describe('writeTimeSeriesData', () => {
    it('should write time-series data only', async () => {
      const timeSeriesData = {
        groupBy: 'hourly',
        timezone: 'UTC',
        totalPageviews: 100,
        uniqueVisitors: 50,
        buckets: [
          { timestamp: '2026-01-08T10:00:00Z', pageviews: 30, uniqueVisitors: 15 },
          { timestamp: '2026-01-08T11:00:00Z', pageviews: 70, uniqueVisitors: 35 }
        ]
      };

      const siteConfig = { siteId: 'timeseries-test' };

      const outputPath = await writer.writeTimeSeriesData(timeSeriesData, siteConfig, 'hourly');
      const content = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(content);

      expect(parsedData.timeSeries.period).toBe('hourly');
      expect(parsedData.timeSeries.totalPageviews).toBe(100);
      expect(parsedData.timeSeries.buckets).toHaveLength(2);
      expect(path.basename(outputPath)).toContain('timeseries-hourly');
    });
  });

  describe('readDataset', () => {
    it('should read existing dataset', async () => {
      const analyticsData = {
        summary: { totalPageviews: 75, uniqueVisitors: 40 }
      };
      const siteConfig = { siteId: 'read-test' };

      // Write dataset
      await writer.writeDataset(analyticsData, siteConfig);

      // Read it back
      const readData = await writer.readDataset(null, 'read-test');

      expect(readData.summary.totalPageviews).toBe(75);
      expect(readData.summary.uniqueVisitors).toBe(40);
      expect(readData.metadata.site.id).toBe('read-test');
    });

    it('should return null for non-existent dataset', async () => {
      const readData = await writer.readDataset(null, 'non-existent');
      expect(readData).toBeNull();
    });
  });

  describe('listDatasets', () => {
    it('should list all dataset files', async () => {
      // Create multiple datasets
      const siteConfigs = [
        { siteId: 'site1' },
        { siteId: 'site2' },
        { siteId: 'site3' }
      ];

      for (const config of siteConfigs) {
        await writer.writeDataset({ summary: {} }, config);
      }

      const datasets = await writer.listDatasets();
      expect(datasets.length).toBe(3);
      expect(datasets.every(file => file.startsWith('test-analytics'))).toBe(true);
      expect(datasets.every(file => file.endsWith('.yaml'))).toBe(true);
    });

    it('should return empty array for non-existent directory', async () => {
      const emptyWriter = new YamlDatasetWriter({
        outputDir: '/non/existent/path'
      });

      const datasets = await emptyWriter.listDatasets();
      expect(datasets).toEqual([]);
    });
  });

  describe('cleanupBackups', () => {
    it('should clean up old backup files', async () => {
      const siteConfig = { siteId: 'cleanup-test' };

      // Create initial dataset
      await writer.writeDataset({ summary: {} }, siteConfig);

      // Create some updates to generate backups
      for (let i = 0; i < 3; i++) {
        await writer.updateDataset({ summary: { totalPageviews: i * 10 } }, siteConfig);
      }

      // Verify backups were created
      let files = await fs.readdir(testOutputDir);
      let backupFiles = files.filter(file => file.includes('.backup.'));
      expect(backupFiles.length).toBeGreaterThan(0);

      // Backdate the backups: with maxAge 0 a file only counts as "old" once
      // its mtime is strictly in the past, and a backup written in the same
      // millisecond as the cleanup was kept (flaky 2 vs 3)
      const past = new Date(Date.now() - 60 * 1000);
      for (const file of backupFiles) {
        await fs.utimes(path.join(testOutputDir, file), past, past);
      }

      // Clean up backups (use 0 days to clean all)
      const cleanedCount = await writer.cleanupBackups(0);
      expect(cleanedCount).toBe(backupFiles.length);

      // Verify backups were removed
      files = await fs.readdir(testOutputDir);
      backupFiles = files.filter(file => file.includes('.backup.'));
      expect(backupFiles.length).toBe(0);
    });
  });

  describe('metadata generation', () => {
    it('should include generation timestamp and site identification', async () => {
      const siteConfig = {
        siteId: 'metadata-test',
        siteName: 'Metadata Test Site',
        domain: 'metadata.example.com',
        timezone: 'America/New_York'
      };

      const outputPath = await writer.writeDataset({}, siteConfig);
      const content = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(content);

      // Check metadata structure
      expect(parsedData.metadata).toBeDefined();
      expect(parsedData.metadata.generatedAt).toBeDefined();
      expect(parsedData.metadata.generatedBy).toBe('Metrona Analytics System');
      expect(parsedData.metadata.version).toBe('1.0.0');

      // Check site identification
      expect(parsedData.metadata.site.id).toBe('metadata-test');
      expect(parsedData.metadata.site.name).toBe('Metadata Test Site');
      expect(parsedData.metadata.site.domain).toBe('metadata.example.com');
      expect(parsedData.metadata.site.timezone).toBe('America/New_York');

      // Check schema information
      expect(parsedData.metadata.schema.version).toBe('1.0');
      expect(parsedData.metadata.schema.format).toBe('yaml');
    });

    it('should use default values for missing site config', async () => {
      const outputPath = await writer.writeDataset({}, {});
      const content = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(content);

      expect(parsedData.metadata.site.id).toBe('default');
      expect(parsedData.metadata.site.name).toBe('Default Site');
      expect(parsedData.metadata.site.domain).toBe('localhost');
      expect(parsedData.metadata.site.timezone).toBe('UTC');
    });
  });

  describe('utility functions', () => {
    it('should create YAML writer with createYamlWriter', () => {
      const yamlWriter = createYamlWriter({ filePrefix: 'utility-test' });
      
      expect(yamlWriter).toBeInstanceOf(YamlDatasetWriter);
      expect(yamlWriter.filePrefix).toBe('utility-test');
    });

    it('should write analytics dataset with writeAnalyticsDataset', async () => {
      const analyticsData = {
        summary: { totalPageviews: 200, uniqueVisitors: 100 }
      };
      const siteConfig = { siteId: 'utility-test' };

      const outputPath = await writeAnalyticsDataset(analyticsData, siteConfig, {
        outputDir: testOutputDir,
        filePrefix: 'utility'
      });

      const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
      
      const content = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(content);
      expect(parsedData.summary.totalPageviews).toBe(200);
    });
  });

  describe('error handling', () => {
    it('should handle corrupted existing files gracefully', async () => {
      const siteConfig = { siteId: 'corrupted-test' };
      const filename = writer.generateFilename(siteConfig.siteId);
      const filePath = path.join(testOutputDir, filename);

      // Create output directory and write corrupted file
      await writer.ensureOutputDirectory();
      await fs.writeFile(filePath, 'invalid: yaml: content: [', 'utf8');

      // Update should handle corrupted file and create new one
      const newData = { summary: { totalPageviews: 50 } };
      const outputPath = await writer.updateDataset(newData, siteConfig);

      const content = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(content);
      expect(parsedData.summary.totalPageviews).toBe(50);
    });

    it('should handle backup creation failures gracefully', async () => {
      // This test would require mocking fs operations to simulate failures
      // For now, we'll just verify the method exists and doesn't throw
      const siteConfig = { siteId: 'backup-fail-test' };
      
      // Create initial file
      await writer.writeDataset({ summary: {} }, siteConfig);
      
      // Update should not throw even if backup fails
      await expect(writer.updateDataset({ summary: { totalPageviews: 10 } }, siteConfig))
        .resolves.toBeDefined();
    });
  });

  describe('filename generation', () => {
    it('should generate consistent filenames', () => {
      const filename1 = writer.generateFilename('test-site');
      const filename2 = writer.generateFilename('test-site');
      
      // Should be same format (same date)
      expect(filename1.split('-').slice(0, -1)).toEqual(filename2.split('-').slice(0, -1));
      expect(filename1).toMatch(/^test-analytics-test-site-\d{4}-\d{2}-\d{2}\.yaml$/);
    });

    it('should use default site ID when none provided', () => {
      const filename = writer.generateFilename();
      expect(filename).toMatch(/^test-analytics-default-\d{4}-\d{2}-\d{2}\.yaml$/);
    });
  });
});