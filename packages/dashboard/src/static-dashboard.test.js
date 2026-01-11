/**
 * @fileoverview Unit tests for StaticDashboard
 */

const { StaticDashboard } = require('./static-dashboard');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('StaticDashboard', () => {
  let tempDir;
  let dashboard;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-test-'));
    dashboard = new StaticDashboard({
      dataDir: path.join(tempDir, 'data'),
      outputDir: path.join(tempDir, 'output'),
      sites: [
        { siteId: 'example-com', domain: 'example.com' },
        { siteId: 'test-site', domain: 'test.example.com' }
      ]
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    test('should initialize with default options', () => {
      const defaultDashboard = new StaticDashboard();
      expect(defaultDashboard.dataDir).toBe('./data');
      expect(defaultDashboard.outputDir).toBe('./public');
      expect(defaultDashboard.sites).toEqual([]);
    });

    test('should initialize with custom options', () => {
      expect(dashboard.dataDir).toBe(path.join(tempDir, 'data'));
      expect(dashboard.outputDir).toBe(path.join(tempDir, 'output'));
      expect(dashboard.sites).toHaveLength(2);
    });
  });

  describe('loadSiteData', () => {
    test('should load valid YAML data', async () => {
      const dataDir = path.join(tempDir, 'data');
      await fs.mkdir(dataDir, { recursive: true });
      
      const sampleData = {
        metadata: { generated_at: '2024-01-01T00:00:00Z' },
        summary: { total_pageviews: 1000, unique_visitors: 500 },
        top_pages: [{ path: '/', pageviews: 500 }]
      };
      
      const yaml = require('js-yaml');
      await fs.writeFile(
        path.join(dataDir, 'example-com.yaml'),
        yaml.dump(sampleData),
        'utf8'
      );

      const result = await dashboard.loadSiteData('example-com');
      expect(result).toEqual(sampleData);
    });

    test('should throw error for missing file', async () => {
      await expect(dashboard.loadSiteData('nonexistent')).rejects.toThrow('Analytics data file not found');
    });

    test('should throw error for invalid YAML', async () => {
      const dataDir = path.join(tempDir, 'data');
      await fs.mkdir(dataDir, { recursive: true });
      
      await fs.writeFile(
        path.join(dataDir, 'invalid.yaml'),
        'invalid: yaml: content:',
        'utf8'
      );

      await expect(dashboard.loadSiteData('invalid')).rejects.toThrow('Failed to parse YAML data');
    });
  });

  describe('loadAllSiteData', () => {
    test('should load data for all configured sites', async () => {
      const dataDir = path.join(tempDir, 'data');
      await fs.mkdir(dataDir, { recursive: true });
      
      const yaml = require('js-yaml');
      const sampleData = {
        metadata: { generated_at: '2024-01-01T00:00:00Z' },
        summary: { total_pageviews: 1000, unique_visitors: 500 }
      };
      
      await fs.writeFile(
        path.join(dataDir, 'example-com.yaml'),
        yaml.dump(sampleData),
        'utf8'
      );

      const result = await dashboard.loadAllSiteData();
      
      expect(result).toHaveProperty('example-com');
      expect(result['example-com'].data).toEqual(sampleData);
      expect(result['example-com'].config.domain).toBe('example.com');
      
      expect(result).toHaveProperty('test-site');
      expect(result['test-site'].data).toBeNull();
      expect(result['test-site'].error).toContain('Analytics data file not found');
    });
  });

  describe('generateIndexHTML', () => {
    test('should generate valid HTML for index page', () => {
      const siteData = {
        'example-com': {
          config: { domain: 'example.com' },
          data: {
            summary: { total_pageviews: 1000, unique_visitors: 500 }
          },
          lastUpdated: '2024-01-01T00:00:00Z'
        }
      };

      const html = dashboard.generateIndexHTML(siteData);
      
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Metrona Analytics Dashboard');
      expect(html).toContain('example.com');
      expect(html).toContain('1,000');
      expect(html).toContain('500');
    });

    test('should handle sites with no data', () => {
      const siteData = {
        'broken-site': {
          config: { domain: 'broken.com' },
          data: null,
          error: 'File not found',
          lastUpdated: '2024-01-01T00:00:00Z'
        }
      };

      const html = dashboard.generateIndexHTML(siteData);
      
      expect(html).toContain('broken.com');
      expect(html).toContain('Data unavailable');
      expect(html).toContain('File not found');
    });
  });

  describe('generateSiteHTML', () => {
    test('should generate valid HTML for site page', () => {
      const siteId = 'example-com';
      const site = {
        config: { domain: 'example.com' },
        data: {
          metadata: { generated_at: '2024-01-01T00:00:00Z' },
          summary: { 
            total_pageviews: 1000, 
            unique_visitors: 500,
            top_pages: [{ path: '/', pageviews: 300 }]
          },
          top_pages: [
            { path: '/', pageviews: 300, unique_visitors: 200, percentage: 30.0 },
            { path: '/about', pageviews: 200, unique_visitors: 150, percentage: 20.0 }
          ],
          referrers: {
            by_domain: [
              { domain: 'google.com', visits: 100, unique_visitors: 80, percentage: 10.0 }
            ]
          },
          time_series: {
            daily: [
              { date: '2024-01-01', pageviews: 50, unique_visitors: 30 },
              { date: '2024-01-02', pageviews: 60, unique_visitors: 35 }
            ]
          }
        },
        lastUpdated: '2024-01-01T00:00:00Z'
      };

      const html = dashboard.generateSiteHTML(siteId, site);
      
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('example.com');
      expect(html).toContain('1,000');
      expect(html).toContain('500');
      expect(html).toContain('Top Pages');
      expect(html).toContain('Top Referrers');
      expect(html).toContain('Traffic Trends');
    });
  });

  describe('generateTopPagesSection', () => {
    test('should generate table for top pages', () => {
      const topPages = [
        { path: '/', pageviews: 300, unique_visitors: 200, percentage: 30.0 },
        { path: '/about', pageviews: 200, unique_visitors: 150, percentage: 20.0 }
      ];

      const html = dashboard.generateTopPagesSection(topPages);
      
      expect(html).toContain('Top Pages');
      expect(html).toContain('<table');
      expect(html).toContain('/');
      expect(html).toContain('/about');
      expect(html).toContain('300');
      expect(html).toContain('30.0%');
    });

    test('should handle empty top pages', () => {
      const html = dashboard.generateTopPagesSection([]);
      
      expect(html).toContain('Top Pages');
      expect(html).toContain('No page data available');
    });
  });

  describe('generateReferrersSection', () => {
    test('should generate table for referrers', () => {
      const referrers = {
        by_domain: [
          { domain: 'google.com', visits: 100, unique_visitors: 80, percentage: 10.0 },
          { domain: 'facebook.com', visits: 50, unique_visitors: 40, percentage: 5.0 }
        ]
      };

      const html = dashboard.generateReferrersSection(referrers);
      
      expect(html).toContain('Top Referrers');
      expect(html).toContain('<table');
      expect(html).toContain('google.com');
      expect(html).toContain('facebook.com');
      expect(html).toContain('100');
      expect(html).toContain('10.0%');
    });

    test('should handle empty referrers', () => {
      const html = dashboard.generateReferrersSection({ by_domain: [] });
      
      expect(html).toContain('Top Referrers');
      expect(html).toContain('No referrer data available');
    });
  });

  describe('generateTimeSeriesSection', () => {
    test('should generate chart section for time series', () => {
      const timeSeries = {
        daily: [
          { date: '2024-01-01', pageviews: 50, unique_visitors: 30 },
          { date: '2024-01-02', pageviews: 60, unique_visitors: 35 }
        ]
      };

      const html = dashboard.generateTimeSeriesSection(timeSeries);
      
      expect(html).toContain('Traffic Trends');
      expect(html).toContain('<canvas');
      expect(html).toContain('window.chartData');
      expect(html).toContain('2024-01-01');
    });

    test('should handle empty time series', () => {
      const html = dashboard.generateTimeSeriesSection({ daily: [] });
      
      expect(html).toContain('Traffic Trends');
      expect(html).toContain('No time series data available');
    });
  });

  describe('generateCSS', () => {
    test('should generate valid CSS', () => {
      const css = dashboard.generateCSS();
      
      expect(css).toContain('/* Metrona Analytics Dashboard Styles */');
      expect(css).toContain('.container');
      expect(css).toContain('.header');
      expect(css).toContain('.card');
      expect(css).toContain('@media');
    });
  });

  describe('generateJavaScript', () => {
    test('should generate valid JavaScript', () => {
      const js = dashboard.generateJavaScript();
      
      expect(js).toContain('// Metrona Analytics Dashboard JavaScript');
      expect(js).toContain('DOMContentLoaded');
      expect(js).toContain('initializeChart');
      expect(js).toContain('drawChart');
    });
  });

  describe('escapeHtml', () => {
    test('should escape HTML special characters', () => {
      expect(dashboard.escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(dashboard.escapeHtml('A & B')).toBe('A &amp; B');
      expect(dashboard.escapeHtml("It's a test")).toBe('It&#39;s a test');
    });

    test('should handle non-string input', () => {
      expect(dashboard.escapeHtml(null)).toBe('');
      expect(dashboard.escapeHtml(undefined)).toBe('');
      expect(dashboard.escapeHtml(123)).toBe('');
    });
  });

  describe('generateDashboard', () => {
    test('should generate complete dashboard', async () => {
      const dataDir = path.join(tempDir, 'data');
      await fs.mkdir(dataDir, { recursive: true });
      
      const yaml = require('js-yaml');
      const sampleData = {
        metadata: { generated_at: '2024-01-01T00:00:00Z' },
        summary: { total_pageviews: 1000, unique_visitors: 500 },
        top_pages: [{ path: '/', pageviews: 500, unique_visitors: 300, percentage: 50.0 }],
        referrers: { by_domain: [] },
        time_series: { daily: [] }
      };
      
      await fs.writeFile(
        path.join(dataDir, 'example-com.yaml'),
        yaml.dump(sampleData),
        'utf8'
      );

      const result = await dashboard.generateDashboard();
      
      expect(result.success).toBe(true);
      expect(result.sites).toContain('example-com');
      expect(result.files).toContain('index.html');
      expect(result.files).toContain('example-com.html');
      expect(result.files).toContain('styles.css');
      expect(result.files).toContain('dashboard.js');

      // Verify files were created
      const outputDir = path.join(tempDir, 'output');
      const indexExists = await fs.access(path.join(outputDir, 'index.html')).then(() => true).catch(() => false);
      const siteExists = await fs.access(path.join(outputDir, 'example-com.html')).then(() => true).catch(() => false);
      const cssExists = await fs.access(path.join(outputDir, 'styles.css')).then(() => true).catch(() => false);
      const jsExists = await fs.access(path.join(outputDir, 'dashboard.js')).then(() => true).catch(() => false);
      
      expect(indexExists).toBe(true);
      expect(siteExists).toBe(true);
      expect(cssExists).toBe(true);
      expect(jsExists).toBe(true);
    });

    test('should handle generation errors gracefully', async () => {
      // Use invalid output directory
      dashboard.outputDir = '/invalid/path/that/does/not/exist';
      
      await expect(dashboard.generateDashboard()).rejects.toThrow('Dashboard generation failed');
    });
  });
});