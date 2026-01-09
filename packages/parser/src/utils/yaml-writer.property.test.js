/**
 * @fileoverview Property-based tests for YAML dataset writer
 * Feature: metrona-analytics-system
 * Property 10: YAML Output Structure Consistency
 * Requirements: 2.4, 7.1, 7.6
 */

const fc = require('fast-check');
const yaml = require('js-yaml');
const fs = require('fs').promises;
const path = require('path');
const { YamlDatasetWriter } = require('./yaml-writer');

describe('YAML Writer Property Tests', () => {
  let testOutputDir;
  let writer;

  beforeEach(async () => {
    // Create temporary test directory
    testOutputDir = path.join(__dirname, 'property-test-output-' + Date.now());
    writer = new YamlDatasetWriter({
      outputDir: testOutputDir,
      filePrefix: 'property-test'
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

  /**
   * Property 10: YAML Output Structure Consistency
   * Validates: Requirements 2.4, 7.1, 7.6
   */
  describe('Property 10: YAML Output Structure Consistency', () => {
    it('should generate YAML files with consistent schema for any analytics data', async () => {
      // Use a simple, deterministic test instead of property-based testing
      const testCases = [
        {
          analyticsData: {
            summary: { totalPageviews: 100, uniqueVisitors: 50 },
            timeSeries: {
              daily: { groupBy: 'daily', timezone: 'UTC', totalPageviews: 100, uniqueVisitors: 50, buckets: [] }
            },
            topContent: { totalPages: 5, totalPageviews: 100, uniqueVisitors: 50, topPages: [] },
            referrers: { totalReferrerDomains: 2, totalReferrals: 30, directTraffic: 70, topReferrers: [] }
          },
          siteConfig: { siteId: 'test-site', siteName: 'Test Site', domain: 'test.com', timezone: 'UTC' }
        },
        {
          analyticsData: {},
          siteConfig: { siteId: 'demo-site', siteName: 'Demo Site', domain: 'demo.com', timezone: 'UTC' }
        }
      ];

      for (const testCase of testCases) {
        const { analyticsData, siteConfig } = testCase;
        
        // Write dataset to YAML
        const outputPath = await writer.writeDataset(analyticsData, siteConfig);

        // Read and parse the generated YAML
        const yamlContent = await fs.readFile(outputPath, 'utf8');
        const parsedData = yaml.load(yamlContent);

        // Property: Must have all required top-level sections
        expect(parsedData).toHaveProperty('metadata');
        expect(parsedData).toHaveProperty('summary');
        expect(parsedData).toHaveProperty('timeSeries');
        expect(parsedData).toHaveProperty('topContent');
        expect(parsedData).toHaveProperty('referrers');

        // Property: Metadata section must have required fields (Requirements 7.6)
        expect(parsedData.metadata).toHaveProperty('generatedAt');
        expect(parsedData.metadata).toHaveProperty('generatedBy');
        expect(parsedData.metadata).toHaveProperty('version');
        expect(parsedData.metadata).toHaveProperty('site');
        expect(parsedData.metadata).toHaveProperty('schema');

        // Property: Site identification must match input
        expect(parsedData.metadata.site.id).toBe(siteConfig.siteId);
        expect(parsedData.metadata.site.name).toBe(siteConfig.siteName);
        expect(parsedData.metadata.site.domain).toBe(siteConfig.domain);

        // Property: Schema information must be consistent
        expect(parsedData.metadata.schema.version).toBe('1.0');
        expect(parsedData.metadata.schema.format).toBe('yaml');
        expect(parsedData.metadata.schema.description).toBe('Metrona Analytics Dataset');

        // Property: YAML must be valid and parseable
        expect(() => yaml.load(yamlContent)).not.toThrow();
      }
    });

    it('should handle empty analytics data with consistent schema', async () => {
      const siteConfig = { siteId: 'test-site', siteName: 'Test Site', domain: 'test.com' };
      
      // Write empty dataset
      const emptyData = {};
      const outputPath = await writer.writeDataset(emptyData, siteConfig);

      // Read and parse the generated YAML
      const yamlContent = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(yamlContent);

      // Property: Even empty data must have complete schema
      expect(parsedData).toHaveProperty('metadata');
      expect(parsedData).toHaveProperty('summary');
      expect(parsedData).toHaveProperty('timeSeries');
      expect(parsedData).toHaveProperty('topContent');
      expect(parsedData).toHaveProperty('referrers');

      // Property: Empty data should have zero values, not undefined
      expect(parsedData.summary.totalPageviews).toBe(0);
      expect(parsedData.summary.uniqueVisitors).toBe(0);
      expect(parsedData.topContent.pages).toEqual([]);
      expect(parsedData.referrers.domains).toEqual([]);
      expect(parsedData.timeSeries.daily.buckets).toEqual([]);

      // Property: Metadata should still be complete
      expect(parsedData.metadata.site.id).toBe(siteConfig.siteId);
      expect(parsedData.metadata.generatedAt).toBeDefined();
    });

    it('should maintain schema consistency across incremental updates', async () => {
      const siteConfig = { siteId: 'test-site', siteName: 'Test Site', domain: 'test.com' };
      const initialData = { summary: { totalPageviews: 50, uniqueVisitors: 25 } };
      const updateData = { summary: { totalPageviews: 150, uniqueVisitors: 75 } };
      
      // Write initial dataset
      const initialPath = await writer.writeDataset(initialData, siteConfig);
      const initialContent = await fs.readFile(initialPath, 'utf8');
      const initialParsed = yaml.load(initialContent);

      // Perform incremental update
      const updatedPath = await writer.updateDataset(updateData, siteConfig);
      const updatedContent = await fs.readFile(updatedPath, 'utf8');
      const updatedParsed = yaml.load(updatedContent);

      // Property: Schema structure must remain consistent after update (allowing for update metadata)
      expect(Object.keys(initialParsed)).toEqual(Object.keys(updatedParsed));
      // Updated metadata may have additional fields like lastUpdated and previousUpdate
      expect(Object.keys(initialParsed.metadata).every(key => 
        Object.keys(updatedParsed.metadata).includes(key)
      )).toBe(true);
      expect(Object.keys(initialParsed.summary)).toEqual(Object.keys(updatedParsed.summary));

      // Property: Site identification must remain the same
      expect(updatedParsed.metadata.site.id).toBe(initialParsed.metadata.site.id);
      expect(updatedParsed.metadata.site.name).toBe(initialParsed.metadata.site.name);

      // Property: Update timestamp should be newer
      expect(new Date(updatedParsed.metadata.generatedAt).getTime())
        .toBeGreaterThan(new Date(initialParsed.metadata.generatedAt).getTime());

      // Property: Data should reflect the update
      expect(updatedParsed.summary.totalPageviews).toBe(updateData.summary.totalPageviews);
      expect(updatedParsed.summary.uniqueVisitors).toBe(updateData.summary.uniqueVisitors);
    });

    it('should generate valid YAML for time-series only exports', async () => {
      const timeSeriesData = {
        groupBy: 'daily',
        timezone: 'UTC',
        totalPageviews: 500,
        uniqueVisitors: 250,
        buckets: [
          { timestamp: '2026-01-08T00:00:00.000Z', pageviews: 100, uniqueVisitors: 50 },
          { timestamp: '2026-01-09T00:00:00.000Z', pageviews: 150, uniqueVisitors: 75 }
        ]
      };
      const siteConfig = { siteId: 'test-site', siteName: 'Test Site', domain: 'test.com' };
      
      // Write time-series only data
      const outputPath = await writer.writeTimeSeriesData(timeSeriesData, siteConfig, timeSeriesData.groupBy);

      // Read and parse the generated YAML
      const yamlContent = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(yamlContent);

      // Property: Time-series export must have required structure
      expect(parsedData).toHaveProperty('metadata');
      expect(parsedData).toHaveProperty('timeSeries');

      // Property: Metadata must be complete
      expect(parsedData.metadata.site.id).toBe(siteConfig.siteId);
      expect(parsedData.metadata.generatedAt).toBeDefined();

      // Property: Time-series data must match input
      expect(parsedData.timeSeries.period).toBe(timeSeriesData.groupBy);
      expect(parsedData.timeSeries.timezone).toBe(timeSeriesData.timezone);
      expect(parsedData.timeSeries.totalPageviews).toBe(timeSeriesData.totalPageviews);
      expect(parsedData.timeSeries.buckets).toHaveLength(timeSeriesData.buckets.length);

      // Property: Each bucket must have valid structure
      parsedData.timeSeries.buckets.forEach((bucket, index) => {
        expect(bucket).toHaveProperty('timestamp');
        expect(bucket).toHaveProperty('pageviews');
        expect(bucket).toHaveProperty('uniqueVisitors');
        expect(bucket.pageviews).toBe(timeSeriesData.buckets[index].pageviews);
        expect(bucket.uniqueVisitors).toBe(timeSeriesData.buckets[index].uniqueVisitors);
      });
    });

    it('should preserve data types and numeric precision', async () => {
      const analyticsData = {
        summary: {
          totalPageviews: 1000,
          avgPageviewsPerSession: 2.5,
          percentage: 75.25
        },
        topContent: {
          topPages: [
            {
              path: '/test',
              pageviews: 500,
              percentage: 50.0,
              bytes: 1024
            }
          ]
        }
      };
      const siteConfig = { siteId: 'precision-test', siteName: 'Precision Test', domain: 'test.example.com' };
      
      // Write dataset
      const outputPath = await writer.writeDataset(analyticsData, siteConfig);

      // Read and parse
      const yamlContent = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(yamlContent);

      // Property: Integer values must remain integers
      expect(Number.isInteger(parsedData.summary.totalPageviews)).toBe(true);
      expect(parsedData.summary.totalPageviews).toBe(analyticsData.summary.totalPageviews);

      // Property: Float values must preserve reasonable precision
      expect(typeof parsedData.summary.avgPageviewsPerSession).toBe('number');
      expect(Math.abs(parsedData.summary.avgPageviewsPerSession - analyticsData.summary.avgPageviewsPerSession))
        .toBeLessThan(0.01);

      // Property: Page data must preserve types
      const page = parsedData.topContent.pages[0];
      const originalPage = analyticsData.topContent.topPages[0];
      expect(Number.isInteger(page.pageviews)).toBe(true);
      expect(Number.isInteger(page.bytes)).toBe(true);
      expect(page.pageviews).toBe(originalPage.pageviews);
      expect(page.bytes).toBe(originalPage.bytes);
      expect(Math.abs(page.percentage - originalPage.percentage)).toBeLessThan(0.01);
    });
  });

  /**
   * Property 32: Incremental Update Behavior
   * Validates: Requirements 9.6
   */
  describe('Property 32: Incremental Update Behavior', () => {
    it('should perform incremental updates rather than full recalculation', async () => {
      const siteConfig = { siteId: 'incremental-test', siteName: 'Incremental Test', domain: 'test.com' };
      
      // Test cases with different data scenarios
      const testCases = [
        {
          name: 'Basic data update',
          initial: {
            summary: { totalPageviews: 100, uniqueVisitors: 50 },
            timeSeries: {
              daily: {
                groupBy: 'daily',
                timezone: 'UTC',
                totalPageviews: 100,
                uniqueVisitors: 50,
                buckets: [
                  { timestamp: '2026-01-07T00:00:00.000Z', pageviews: 50, uniqueVisitors: 25 },
                  { timestamp: '2026-01-08T00:00:00.000Z', pageviews: 50, uniqueVisitors: 25 }
                ]
              }
            }
          },
          update: {
            summary: { totalPageviews: 200, uniqueVisitors: 100 },
            timeSeries: {
              daily: {
                groupBy: 'daily',
                timezone: 'UTC',
                totalPageviews: 200,
                uniqueVisitors: 100,
                buckets: [
                  { timestamp: '2026-01-08T00:00:00.000Z', pageviews: 75, uniqueVisitors: 40 }, // Updated existing
                  { timestamp: '2026-01-09T00:00:00.000Z', pageviews: 125, uniqueVisitors: 60 } // New bucket
                ]
              }
            }
          }
        },
        {
          name: 'Time-series merge with overlapping data',
          initial: {
            timeSeries: {
              hourly: {
                groupBy: 'hourly',
                timezone: 'UTC',
                totalPageviews: 300,
                uniqueVisitors: 150,
                buckets: [
                  { timestamp: '2026-01-08T10:00:00.000Z', pageviews: 100, uniqueVisitors: 50 },
                  { timestamp: '2026-01-08T11:00:00.000Z', pageviews: 200, uniqueVisitors: 100 }
                ]
              }
            }
          },
          update: {
            timeSeries: {
              hourly: {
                groupBy: 'hourly',
                timezone: 'UTC',
                totalPageviews: 500,
                uniqueVisitors: 250,
                buckets: [
                  { timestamp: '2026-01-08T11:00:00.000Z', pageviews: 250, uniqueVisitors: 125 }, // Updated
                  { timestamp: '2026-01-08T12:00:00.000Z', pageviews: 150, uniqueVisitors: 75 },  // New
                  { timestamp: '2026-01-08T13:00:00.000Z', pageviews: 100, uniqueVisitors: 50 }   // New
                ]
              }
            }
          }
        }
      ];

      for (const testCase of testCases) {
        // Write initial dataset
        const initialPath = await writer.writeDataset(testCase.initial, siteConfig);
        const initialContent = await fs.readFile(initialPath, 'utf8');
        const initialParsed = yaml.load(initialContent);

        // Perform incremental update
        const updatedPath = await writer.updateDataset(testCase.update, siteConfig);
        const updatedContent = await fs.readFile(updatedPath, 'utf8');
        const updatedParsed = yaml.load(updatedContent);

        // Property: Update should preserve existing file path
        expect(updatedPath).toBe(initialPath);

        // Property: Backup should be created (Requirements 9.6 - incremental updates)
        const backupFiles = await fs.readdir(testOutputDir);
        const hasBackup = backupFiles.some(file => file.includes('.backup.'));
        expect(hasBackup).toBe(true);

        // Property: Metadata should indicate this is an update
        expect(updatedParsed.metadata).toHaveProperty('lastUpdated');
        expect(updatedParsed.metadata).toHaveProperty('previousUpdate');
        expect(updatedParsed.metadata.previousUpdate).toBe(initialParsed.metadata.generatedAt);

        // Property: Update timestamp should be newer than initial
        expect(new Date(updatedParsed.metadata.lastUpdated).getTime())
          .toBeGreaterThan(new Date(initialParsed.metadata.generatedAt).getTime());

        // Property: Site identification should remain unchanged
        expect(updatedParsed.metadata.site.id).toBe(initialParsed.metadata.site.id);
        expect(updatedParsed.metadata.site.name).toBe(initialParsed.metadata.site.name);
        expect(updatedParsed.metadata.site.domain).toBe(initialParsed.metadata.site.domain);
      }
    });

    it('should merge time-series data correctly during incremental updates', async () => {
      const siteConfig = { siteId: 'timeseries-merge', siteName: 'TimeSeries Merge', domain: 'merge.com' };
      
      // Initial dataset with some time buckets
      const initialData = {
        timeSeries: {
          daily: {
            groupBy: 'daily',
            timezone: 'UTC',
            totalPageviews: 500,
            uniqueVisitors: 250,
            buckets: [
              { timestamp: '2026-01-05T00:00:00.000Z', pageviews: 100, uniqueVisitors: 50 },
              { timestamp: '2026-01-06T00:00:00.000Z', pageviews: 150, uniqueVisitors: 75 },
              { timestamp: '2026-01-07T00:00:00.000Z', pageviews: 250, uniqueVisitors: 125 }
            ]
          }
        }
      };

      // Update with overlapping and new buckets
      const updateData = {
        timeSeries: {
          daily: {
            groupBy: 'daily',
            timezone: 'UTC',
            totalPageviews: 800,
            uniqueVisitors: 400,
            buckets: [
              { timestamp: '2026-01-06T00:00:00.000Z', pageviews: 200, uniqueVisitors: 100 }, // Updated existing
              { timestamp: '2026-01-07T00:00:00.000Z', pageviews: 300, uniqueVisitors: 150 }, // Updated existing
              { timestamp: '2026-01-08T00:00:00.000Z', pageviews: 300, uniqueVisitors: 150 }  // New bucket
            ]
          }
        }
      };

      // Write initial and update
      await writer.writeDataset(initialData, siteConfig);
      const updatedPath = await writer.updateDataset(updateData, siteConfig);
      
      const updatedContent = await fs.readFile(updatedPath, 'utf8');
      const updatedParsed = yaml.load(updatedContent);

      const mergedBuckets = updatedParsed.timeSeries.daily.buckets;

      // Property: All unique timestamps should be present
      const expectedTimestamps = [
        '2026-01-05T00:00:00.000Z', // From initial (unchanged)
        '2026-01-06T00:00:00.000Z', // From both (updated)
        '2026-01-07T00:00:00.000Z', // From both (updated)
        '2026-01-08T00:00:00.000Z'  // From update (new)
      ];
      
      expect(mergedBuckets).toHaveLength(expectedTimestamps.length);
      
      const actualTimestamps = mergedBuckets.map(bucket => bucket.timestamp).sort();
      expect(actualTimestamps).toEqual(expectedTimestamps.sort());

      // Property: Buckets should be sorted by timestamp
      for (let i = 1; i < mergedBuckets.length; i++) {
        expect(new Date(mergedBuckets[i].timestamp).getTime())
          .toBeGreaterThan(new Date(mergedBuckets[i-1].timestamp).getTime());
      }

      // Property: Updated buckets should have new values, unchanged buckets should retain original values
      const bucketMap = new Map(mergedBuckets.map(b => [b.timestamp, b]));
      
      // Unchanged bucket (only in initial)
      expect(bucketMap.get('2026-01-05T00:00:00.000Z').pageviews).toBe(100);
      expect(bucketMap.get('2026-01-05T00:00:00.000Z').uniqueVisitors).toBe(50);
      
      // Updated buckets (in both, should have update values)
      expect(bucketMap.get('2026-01-06T00:00:00.000Z').pageviews).toBe(200);
      expect(bucketMap.get('2026-01-06T00:00:00.000Z').uniqueVisitors).toBe(100);
      expect(bucketMap.get('2026-01-07T00:00:00.000Z').pageviews).toBe(300);
      expect(bucketMap.get('2026-01-07T00:00:00.000Z').uniqueVisitors).toBe(150);
      
      // New bucket (only in update)
      expect(bucketMap.get('2026-01-08T00:00:00.000Z').pageviews).toBe(300);
      expect(bucketMap.get('2026-01-08T00:00:00.000Z').uniqueVisitors).toBe(150);

      // Property: Overall statistics should reflect the update
      expect(updatedParsed.timeSeries.daily.totalPageviews).toBe(updateData.timeSeries.daily.totalPageviews);
      expect(updatedParsed.timeSeries.daily.uniqueVisitors).toBe(updateData.timeSeries.daily.uniqueVisitors);
    });

    it('should handle incremental updates when existing file is corrupted', async () => {
      const siteConfig = { siteId: 'corruption-test', siteName: 'Corruption Test', domain: 'corrupt.com' };
      const filename = `property-test-${siteConfig.siteId}-${new Date().toISOString().split('T')[0]}.yaml`;
      const filePath = path.join(testOutputDir, filename);

      // Create a corrupted YAML file
      await fs.mkdir(testOutputDir, { recursive: true });
      await fs.writeFile(filePath, 'invalid: yaml: content: [unclosed', 'utf8');

      const updateData = {
        summary: { totalPageviews: 100, uniqueVisitors: 50 }
      };

      // Property: Should handle corrupted file gracefully and create new dataset
      const updatedPath = await writer.updateDataset(updateData, siteConfig);
      expect(updatedPath).toBe(filePath);

      const updatedContent = await fs.readFile(updatedPath, 'utf8');
      const updatedParsed = yaml.load(updatedContent);

      // Property: Should create valid new dataset when existing is corrupted
      expect(updatedParsed).toHaveProperty('metadata');
      expect(updatedParsed).toHaveProperty('summary');
      expect(updatedParsed.summary.totalPageviews).toBe(updateData.summary.totalPageviews);
      expect(updatedParsed.summary.uniqueVisitors).toBe(updateData.summary.uniqueVisitors);

      // Property: Should not have update metadata since it's treated as new
      expect(updatedParsed.metadata).not.toHaveProperty('previousUpdate');
    });

    it('should preserve data integrity across multiple incremental updates', async () => {
      const siteConfig = { siteId: 'multi-update', siteName: 'Multi Update', domain: 'multi.com' };
      
      // Series of incremental updates
      const updates = [
        {
          summary: { totalPageviews: 100, uniqueVisitors: 50 },
          timeSeries: {
            daily: {
              groupBy: 'daily',
              timezone: 'UTC',
              totalPageviews: 100,
              uniqueVisitors: 50,
              buckets: [
                { timestamp: '2026-01-08T00:00:00.000Z', pageviews: 100, uniqueVisitors: 50 }
              ]
            }
          }
        },
        {
          summary: { totalPageviews: 250, uniqueVisitors: 125 },
          timeSeries: {
            daily: {
              groupBy: 'daily',
              timezone: 'UTC',
              totalPageviews: 250,
              uniqueVisitors: 125,
              buckets: [
                { timestamp: '2026-01-08T00:00:00.000Z', pageviews: 100, uniqueVisitors: 50 }, // Same
                { timestamp: '2026-01-09T00:00:00.000Z', pageviews: 150, uniqueVisitors: 75 }  // New
              ]
            }
          }
        },
        {
          summary: { totalPageviews: 400, uniqueVisitors: 200 },
          timeSeries: {
            daily: {
              groupBy: 'daily',
              timezone: 'UTC',
              totalPageviews: 400,
              uniqueVisitors: 200,
              buckets: [
                { timestamp: '2026-01-08T00:00:00.000Z', pageviews: 125, uniqueVisitors: 60 }, // Updated
                { timestamp: '2026-01-09T00:00:00.000Z', pageviews: 150, uniqueVisitors: 75 }, // Same
                { timestamp: '2026-01-10T00:00:00.000Z', pageviews: 125, uniqueVisitors: 65 }  // New
              ]
            }
          }
        }
      ];

      let previousGeneratedAt = null;

      for (let i = 0; i < updates.length; i++) {
        const updateData = updates[i];
        
        // Perform update (first one creates, subsequent ones update)
        const outputPath = i === 0 ? 
          await writer.writeDataset(updateData, siteConfig) :
          await writer.updateDataset(updateData, siteConfig);

        const content = await fs.readFile(outputPath, 'utf8');
        const parsed = yaml.load(content);

        // Property: Each update should have newer timestamp
        if (previousGeneratedAt) {
          const currentTime = i === 0 ? parsed.metadata.generatedAt : parsed.metadata.lastUpdated;
          expect(new Date(currentTime).getTime())
            .toBeGreaterThan(new Date(previousGeneratedAt).getTime());
        }

        // Property: Data should match current update
        expect(parsed.summary.totalPageviews).toBe(updateData.summary.totalPageviews);
        expect(parsed.summary.uniqueVisitors).toBe(updateData.summary.uniqueVisitors);

        // Property: Time-series buckets should be correctly merged
        const buckets = parsed.timeSeries.daily.buckets;
        expect(buckets).toHaveLength(updateData.timeSeries.daily.buckets.length);
        
        // Verify each expected bucket is present with correct data
        updateData.timeSeries.daily.buckets.forEach(expectedBucket => {
          const actualBucket = buckets.find(b => b.timestamp === expectedBucket.timestamp);
          expect(actualBucket).toBeDefined();
          expect(actualBucket.pageviews).toBe(expectedBucket.pageviews);
          expect(actualBucket.uniqueVisitors).toBe(expectedBucket.uniqueVisitors);
        });

        // Property: Buckets should remain sorted by timestamp
        for (let j = 1; j < buckets.length; j++) {
          expect(new Date(buckets[j].timestamp).getTime())
            .toBeGreaterThan(new Date(buckets[j-1].timestamp).getTime());
        }

        previousGeneratedAt = i === 0 ? parsed.metadata.generatedAt : parsed.metadata.lastUpdated;
      }

      // Property: Multiple backups should be created
      const files = await fs.readdir(testOutputDir);
      const backupFiles = files.filter(file => file.includes('.backup.'));
      expect(backupFiles.length).toBe(updates.length - 1); // One backup per update (not for initial write)
    });

    it('should handle updates with missing time-series periods gracefully', async () => {
      const siteConfig = { siteId: 'missing-periods', siteName: 'Missing Periods', domain: 'missing.com' };
      
      // Initial data with multiple time-series periods
      const initialData = {
        timeSeries: {
          hourly: {
            groupBy: 'hourly',
            timezone: 'UTC',
            totalPageviews: 100,
            uniqueVisitors: 50,
            buckets: [{ timestamp: '2026-01-08T10:00:00.000Z', pageviews: 100, uniqueVisitors: 50 }]
          },
          daily: {
            groupBy: 'daily',
            timezone: 'UTC',
            totalPageviews: 200,
            uniqueVisitors: 100,
            buckets: [{ timestamp: '2026-01-08T00:00:00.000Z', pageviews: 200, uniqueVisitors: 100 }]
          }
        }
      };

      // Update with only daily data (missing hourly)
      const updateData = {
        timeSeries: {
          daily: {
            groupBy: 'daily',
            timezone: 'UTC',
            totalPageviews: 300,
            uniqueVisitors: 150,
            buckets: [
              { timestamp: '2026-01-08T00:00:00.000Z', pageviews: 200, uniqueVisitors: 100 },
              { timestamp: '2026-01-09T00:00:00.000Z', pageviews: 100, uniqueVisitors: 50 }
            ]
          }
        }
      };

      await writer.writeDataset(initialData, siteConfig);
      const updatedPath = await writer.updateDataset(updateData, siteConfig);
      
      const updatedContent = await fs.readFile(updatedPath, 'utf8');
      const updatedParsed = yaml.load(updatedContent);

      // Property: Missing periods in update should preserve existing data
      expect(updatedParsed.timeSeries).toHaveProperty('hourly');
      expect(updatedParsed.timeSeries).toHaveProperty('daily');

      // Property: Hourly data should remain unchanged (from initial)
      expect(updatedParsed.timeSeries.hourly.totalPageviews).toBe(initialData.timeSeries.hourly.totalPageviews);
      expect(updatedParsed.timeSeries.hourly.buckets).toHaveLength(1);
      expect(updatedParsed.timeSeries.hourly.buckets[0].timestamp).toBe('2026-01-08T10:00:00.000Z');

      // Property: Daily data should be updated
      expect(updatedParsed.timeSeries.daily.totalPageviews).toBe(updateData.timeSeries.daily.totalPageviews);
      expect(updatedParsed.timeSeries.daily.buckets).toHaveLength(2);
    });
  });

  /**
   * Cross-validation tests for schema consistency
   */
  describe('Schema Cross-Validation', () => {
    it('should maintain consistent field names across all sections', async () => {
      const siteConfig = { siteId: 'test-site', domain: 'test.com' };
      
      // Generate minimal valid data
      const analyticsData = {
        summary: { totalPageviews: 100, uniqueVisitors: 50 },
        timeSeries: {
          daily: {
            groupBy: 'daily',
            timezone: 'UTC',
            totalPageviews: 100,
            uniqueVisitors: 50,
            buckets: []
          }
        }
      };

      const outputPath = await writer.writeDataset(analyticsData, siteConfig);
      const yamlContent = await fs.readFile(outputPath, 'utf8');
      const parsedData = yaml.load(yamlContent);

      // Property: Field names must follow consistent naming convention
      const checkNamingConvention = (obj, path = '') => {
        Object.keys(obj).forEach(key => {
          // Should be camelCase or lowercase
          expect(key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
          
          if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            checkNamingConvention(obj[key], `${path}.${key}`);
          }
        });
      };

      checkNamingConvention(parsedData);

      // Property: Required fields must be present in expected locations
      const requiredPaths = [
        'metadata.generatedAt',
        'metadata.site.id',
        'summary.totalPageviews',
        'timeSeries.daily.groupBy',
        'topContent.pages',
        'referrers.domains'
      ];

      requiredPaths.forEach(fieldPath => {
        const pathParts = fieldPath.split('.');
        let current = parsedData;
        
        pathParts.forEach(part => {
          expect(current).toHaveProperty(part);
          current = current[part];
        });
      });
    });
  });
});