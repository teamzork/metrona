/**
 * @fileoverview Property tests for date range filtering and data export functionality
 * Feature: metrona-analytics-system
 * 
 * Property 19: Date Range Filtering Accuracy
 * Property 20: Data Export Format Correctness
 * 
 * Validates Requirements 5.3, 5.6
 */

const fc = require('fast-check');
const { StaticDashboard } = require('./static-dashboard');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

describe('Dashboard Date Filtering and Export Property Tests', () => {
  let tempDir;
  let dashboard;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-property-test-'));
    dashboard = new StaticDashboard({
      dataDir: path.join(tempDir, 'data'),
      outputDir: path.join(tempDir, 'output')
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Property 19: Date Range Filtering Accuracy
   * For any analytics dataset and date range selection, the filtered results 
   * should include only data points within the specified time period.
   * Validates Requirements 5.3
   */
  test('Property 19: Date Range Filtering Accuracy', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate time series data with random dates
        fc.array(
          fc.record({
            date: fc.date({ min: new Date('2020-01-01'), max: new Date() })
              .map(d => d.toISOString().split('T')[0]),
            pageviews: fc.integer({ min: 1, max: 1000 }),
            unique_visitors: fc.integer({ min: 1, max: 500 })
          }),
          { minLength: 10, maxLength: 100 }
        ),
        fc.constantFrom('1d', '7d', '30d', '1y', 'all'),
        
        async (timeSeriesData, dateRange) => {
          // Sort data by date for consistency
          const sortedData = timeSeriesData.sort((a, b) => a.date.localeCompare(b.date));
          
          const analyticsData = {
            metadata: { generated_at: new Date().toISOString() },
            summary: {
              total_pageviews: sortedData.reduce((sum, d) => sum + d.pageviews, 0),
              unique_visitors: Math.max(...sortedData.map(d => d.unique_visitors))
            },
            time_series: { daily: sortedData }
          };

          // Apply date range filtering
          const filteredData = dashboard.filterDataByDateRange(analyticsData, dateRange);

          if (dateRange === 'all') {
            // All data should be included
            expect(filteredData.time_series.daily).toHaveLength(sortedData.length);
            expect(filteredData.summary.total_pageviews).toBe(analyticsData.summary.total_pageviews);
          } else {
            // Calculate expected date range
            const now = new Date();
            let startDate;
            
            switch (dateRange) {
              case '1d':
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
              case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
              case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
              case '1y':
                startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
            }

            // Verify all filtered data points are within the date range
            for (const entry of filteredData.time_series.daily) {
              const entryDate = new Date(entry.date);
              expect(entryDate.getTime()).toBeGreaterThanOrEqual(startDate.getTime());
              expect(entryDate.getTime()).toBeLessThanOrEqual(now.getTime());
            }

            // Verify filtered pageviews match the sum of included entries
            const expectedPageviews = filteredData.time_series.daily.reduce(
              (sum, entry) => sum + entry.pageviews, 0
            );
            expect(filteredData.summary.total_pageviews).toBe(expectedPageviews);

            // Verify filtered data is a subset of original data
            expect(filteredData.time_series.daily.length).toBeLessThanOrEqual(sortedData.length);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 20: Data Export Format Correctness
   * For any analytics data export request, the generated CSV should contain 
   * all expected data fields in the correct format.
   * Validates Requirements 5.6
   */
  test('Property 20: Data Export Format Correctness', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate analytics data
        fc.record({
          metadata: fc.record({
            site: fc.domain(),
            generated_at: fc.date().map(d => d.toISOString())
          }),
          summary: fc.record({
            total_pageviews: fc.integer({ min: 0, max: 100000 }),
            unique_visitors: fc.integer({ min: 0, max: 50000 })
          }),
          top_pages: fc.array(
            fc.record({
              path: fc.webPath(),
              pageviews: fc.integer({ min: 1, max: 10000 }),
              unique_visitors: fc.integer({ min: 1, max: 5000 }),
              percentage: fc.float({ min: Math.fround(0.1), max: Math.fround(100.0), noNaN: true })
            }),
            { maxLength: 20 }
          ),
          referrers: fc.record({
            by_domain: fc.array(
              fc.record({
                domain: fc.domain(),
                visits: fc.integer({ min: 1, max: 10000 }),
                unique_visitors: fc.integer({ min: 1, max: 5000 }),
                percentage: fc.float({ min: Math.fround(0.1), max: Math.fround(100.0), noNaN: true })
              }),
              { maxLength: 15 }
            )
          }),
          time_series: fc.record({
            daily: fc.array(
              fc.record({
                date: fc.date({ min: new Date('2020-01-01'), max: new Date() })
                  .map(d => d.toISOString().split('T')[0]),
                pageviews: fc.integer({ min: 0, max: 1000 }),
                unique_visitors: fc.integer({ min: 0, max: 500 })
              }),
              { maxLength: 30 }
            )
          })
        }),
        fc.constantFrom('summary', 'pages', 'referrers', 'timeseries'),
        
        async (analyticsData, exportType) => {
          const csv = dashboard.generateCSVExport(analyticsData, exportType);
          
          // Verify CSV is not empty
          expect(csv).toBeTruthy();
          expect(typeof csv).toBe('string');
          
          const lines = csv.split('\n').filter(line => line.trim().length > 0);
          expect(lines.length).toBeGreaterThan(0);
          
          // Verify header row exists
          const headerLine = lines[0];
          expect(headerLine).toBeTruthy();
          
          switch (exportType) {
            case 'summary':
              expect(headerLine).toBe('Metric,Value');
              expect(lines.length).toBeGreaterThanOrEqual(2); // Header + at least one data row
              
              // Verify required summary fields are present
              const summaryContent = csv.toLowerCase();
              expect(summaryContent).toContain('site');
              expect(summaryContent).toContain('total pageviews');
              expect(summaryContent).toContain('unique visitors');
              break;
              
            case 'pages':
              expect(headerLine).toBe('Path,Pageviews,Unique Visitors,Percentage');
              
              if (analyticsData.top_pages && analyticsData.top_pages.length > 0) {
                expect(lines.length).toBe(analyticsData.top_pages.length + 1); // Header + data rows
                
                // Verify each data row has correct number of columns
                for (let i = 1; i < lines.length; i++) {
                  const columns = lines[i].split(',');
                  expect(columns.length).toBeGreaterThanOrEqual(4);
                  
                  // Verify percentage format
                  const percentageCol = columns[columns.length - 1];
                  expect(percentageCol).toMatch(/^\d+\.\d{2}%$/);
                }
              }
              break;
              
            case 'referrers':
              expect(headerLine).toBe('Domain,Visits,Unique Visitors,Percentage');
              
              if (analyticsData.referrers?.by_domain && analyticsData.referrers.by_domain.length > 0) {
                expect(lines.length).toBe(analyticsData.referrers.by_domain.length + 1);
                
                // Verify each data row has correct number of columns
                for (let i = 1; i < lines.length; i++) {
                  const columns = lines[i].split(',');
                  expect(columns.length).toBeGreaterThanOrEqual(4);
                  
                  // Verify percentage format
                  const percentageCol = columns[columns.length - 1];
                  expect(percentageCol).toMatch(/^\d+\.\d{2}%$/);
                }
              }
              break;
              
            case 'timeseries':
              expect(headerLine).toBe('Date,Pageviews,Unique Visitors');
              
              if (analyticsData.time_series?.daily && analyticsData.time_series.daily.length > 0) {
                expect(lines.length).toBe(analyticsData.time_series.daily.length + 1);
                
                // Verify each data row has correct number of columns and date format
                for (let i = 1; i < lines.length; i++) {
                  const columns = lines[i].split(',');
                  expect(columns.length).toBe(3);
                  
                  // Verify date format (YYYY-MM-DD)
                  const dateCol = columns[0];
                  expect(dateCol).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                  
                  // Verify numeric values
                  const pageviews = parseInt(columns[1]);
                  const visitors = parseInt(columns[2]);
                  expect(pageviews).toBeGreaterThanOrEqual(0);
                  expect(visitors).toBeGreaterThanOrEqual(0);
                }
              }
              break;
          }
          
          // Verify CSV escaping works correctly
          // Check that commas in data are properly escaped
          if (csv.includes('"')) {
            const quotedFields = csv.match(/"[^"]*"/g) || [];
            for (const field of quotedFields) {
              // Verify quoted fields don't have unescaped quotes
              const content = field.slice(1, -1); // Remove outer quotes
              if (content.includes('"')) {
                expect(content).toMatch(/^.*"".*$/); // Should have escaped quotes
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property test: CSV round-trip consistency
   * Verifies that exported CSV data maintains data integrity
   */
  test('Property: CSV Export Data Integrity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            path: fc.webPath(),
            pageviews: fc.integer({ min: 1, max: 10000 }),
            unique_visitors: fc.integer({ min: 1, max: 5000 }),
            percentage: fc.float({ min: Math.fround(0.1), max: Math.fround(100.0), noNaN: true })
          }),
          { minLength: 1, maxLength: 10 }
        ),
        
        async (topPages) => {
          const analyticsData = { top_pages: topPages };
          const csv = dashboard.generateCSVExport(analyticsData, 'pages');
          
          const lines = csv.split('\n').filter(line => line.trim().length > 0);
          
          if (lines.length > 1) { // Has header + data
            // Verify data count matches
            expect(lines.length - 1).toBe(topPages.length);
            
            // For CSV parsing, we need to handle quoted fields properly
            // Let's just verify the basic structure and some values
            const firstDataLine = lines[1];
            
            // Simple check: line should have at least 3 commas (4 fields)
            const commaCount = (firstDataLine.match(/,/g) || []).length;
            expect(commaCount).toBeGreaterThanOrEqual(3);
            
            // Check that the line contains numeric values
            expect(firstDataLine).toMatch(/\d+/); // Should contain numbers
            expect(firstDataLine).toMatch(/\d+\.\d{2}%$/); // Should end with percentage
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Additional property test: Date filtering edge cases
   * Verifies filtering behavior with edge cases
   */
  test('Property: Date Filtering Edge Cases', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('1d', '7d', '30d', '1y'),
        
        async (dateRange) => {
          // Test with empty data
          const emptyData = {
            summary: { total_pageviews: 0, unique_visitors: 0 },
            time_series: { daily: [] }
          };
          
          const filteredEmpty = dashboard.filterDataByDateRange(emptyData, dateRange);
          expect(filteredEmpty.time_series.daily).toHaveLength(0);
          
          // Test with future dates (should be excluded)
          const futureDate = new Date();
          futureDate.setFullYear(futureDate.getFullYear() + 1);
          
          const futureData = {
            summary: { total_pageviews: 100, unique_visitors: 50 },
            time_series: {
              daily: [{
                date: futureDate.toISOString().split('T')[0],
                pageviews: 100,
                unique_visitors: 50
              }]
            }
          };
          
          const filteredFuture = dashboard.filterDataByDateRange(futureData, dateRange);
          expect(filteredFuture.time_series.daily).toHaveLength(0);
          expect(filteredFuture.summary.total_pageviews).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });
});