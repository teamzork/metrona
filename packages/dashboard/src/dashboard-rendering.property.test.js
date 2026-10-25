/**
 * @fileoverview Property-based tests for Dashboard Rendering
 * Feature: metrona-analytics-system, Property 18: Comprehensive UI Rendering
 * 
 * Property 18: Comprehensive UI Rendering
 * For any analytics data, the dashboard and components should render all required 
 * information (site overviews, pageviews, top pages, referrer information) in the 
 * expected HTML structure.
 * 
 * Validates: Requirements 5.1, 5.2
 */

const fc = require('fast-check');
const { StaticDashboard } = require('./static-dashboard');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

describe('Dashboard Rendering Property Tests', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-property-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Property 18: Comprehensive UI Rendering
   * For any analytics data, the dashboard and components should render all required 
   * information (site overviews, pageviews, top pages, referrer information) in the 
   * expected HTML structure.
   */
  describe('Property 18: Comprehensive UI Rendering', () => {
    test('should render all required information in expected HTML structure for any analytics data', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate analytics data structure
          fc.record({
            metadata: fc.record({
              generated_at: fc.date().map(d => d.toISOString()),
              site: fc.domain(),
              version: fc.constant(1)
            }),
            summary: fc.record({
              total_pageviews: fc.nat({ max: 1000000 }),
              unique_visitors: fc.nat({ max: 100000 }),
              top_pages: fc.option(fc.array(fc.record({
                path: fc.webPath(),
                pageviews: fc.nat({ max: 10000 })
              }), { minLength: 1, maxLength: 3 }))
            }),
            top_pages: fc.array(fc.record({
              path: fc.webPath(),
              pageviews: fc.nat({ max: 10000 }),
              unique_visitors: fc.nat({ max: 5000 }),
              percentage: fc.float({ min: 0, max: 100, noNaN: true })
            }), { minLength: 0, maxLength: 20 }),
            referrers: fc.record({
              by_domain: fc.array(fc.record({
                domain: fc.domain(),
                visits: fc.nat({ max: 5000 }),
                unique_visitors: fc.nat({ max: 2500 }),
                percentage: fc.float({ min: 0, max: 100, noNaN: true })
              }), { minLength: 0, maxLength: 15 })
            }),
            time_series: fc.record({
              daily: fc.array(fc.record({
                date: fc.date({ min: new Date('2024-01-01'), max: new Date('2024-12-31') })
                  .map(d => d.toISOString().split('T')[0]),
                pageviews: fc.nat({ max: 1000 }),
                unique_visitors: fc.nat({ max: 500 })
              }), { minLength: 0, maxLength: 30 })
            })
          }),
          // Generate site configuration
          fc.record({
            siteId: fc.stringOf(fc.char().filter(c => /[a-z0-9-]/.test(c)), { minLength: 3, maxLength: 20 }),
            domain: fc.domain()
          }),
          async (analyticsData, siteConfig) => {
          // Setup test environment
          const dataDir = path.join(tempDir, 'data');
          const outputDir = path.join(tempDir, 'output');
          await fs.mkdir(dataDir, { recursive: true });

          // Write analytics data to YAML file
          const yamlPath = path.join(dataDir, `${siteConfig.siteId}.yaml`);
          await fs.writeFile(yamlPath, yaml.dump(analyticsData), 'utf8');

          // Create dashboard instance
          const dashboard = new StaticDashboard({
            dataDir,
            outputDir,
            sites: [siteConfig]
          });

          // Generate dashboard
          const result = await dashboard.generateDashboard();

          // Verify generation success
          expect(result.success).toBe(true);
          expect(result.sites).toContain(siteConfig.siteId);

          // Read generated HTML files
          const indexPath = path.join(outputDir, 'index.html');
          const sitePath = path.join(outputDir, `${siteConfig.siteId}.html`);
          
          const indexHTML = await fs.readFile(indexPath, 'utf8');
          const siteHTML = await fs.readFile(sitePath, 'utf8');

          // Property: Index page must contain site overview information
          validateIndexPageStructure(indexHTML, analyticsData, siteConfig);

          // Property: Site page must contain detailed analytics information
          validateSitePageStructure(siteHTML, analyticsData, siteConfig);

          // Property: HTML structure must be valid and complete
          validateHTMLStructure(indexHTML);
          validateHTMLStructure(siteHTML);

          // Property: All numeric data must be properly formatted
          validateNumericFormatting(indexHTML, analyticsData);
          validateNumericFormatting(siteHTML, analyticsData);

          // Property: Security - all user content must be escaped
          validateHTMLEscaping(siteHTML, analyticsData);
        }),
        { numRuns: 100, timeout: 30000 }
      );
    });

    test('should handle empty or minimal analytics data gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate minimal analytics data
          fc.record({
            metadata: fc.record({
              generated_at: fc.date().map(d => d.toISOString()),
              site: fc.domain()
            }),
            summary: fc.record({
              total_pageviews: fc.constant(0),
              unique_visitors: fc.constant(0)
            }),
            top_pages: fc.constant([]),
            referrers: fc.record({
              by_domain: fc.constant([])
            }),
            time_series: fc.record({
              daily: fc.constant([])
            })
          }),
          fc.record({
            siteId: fc.stringOf(fc.char().filter(c => /[a-z0-9-]/.test(c)), { minLength: 3, maxLength: 20 }),
            domain: fc.domain()
          }),
          async (analyticsData, siteConfig) => {
          // Setup test environment
          const dataDir = path.join(tempDir, 'data');
          const outputDir = path.join(tempDir, 'output');
          await fs.mkdir(dataDir, { recursive: true });

          // Write analytics data to YAML file
          const yamlPath = path.join(dataDir, `${siteConfig.siteId}.yaml`);
          await fs.writeFile(yamlPath, yaml.dump(analyticsData), 'utf8');

          // Create dashboard instance
          const dashboard = new StaticDashboard({
            dataDir,
            outputDir,
            sites: [siteConfig]
          });

          // Generate dashboard
          const result = await dashboard.generateDashboard();

          // Verify generation success even with empty data
          expect(result.success).toBe(true);

          // Read generated HTML
          const siteHTML = await fs.readFile(path.join(outputDir, `${siteConfig.siteId}.html`), 'utf8');

          // Property: Empty data should show appropriate messages
          if (analyticsData.top_pages.length === 0) {
            expect(siteHTML).toMatch(/No page data available/i);
          }
          if (analyticsData.referrers.by_domain.length === 0) {
            expect(siteHTML).toMatch(/No referrer data available/i);
          }
          if (analyticsData.time_series.daily.length === 0) {
            expect(siteHTML).toMatch(/No time series data available/i);
          }

          // Property: Zero values should be displayed correctly
          expect(siteHTML).toContain('0');
        }),
        { numRuns: 50, timeout: 20000 }
      );
    });

    test('should render error states consistently for missing data', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            siteId: fc.stringOf(fc.char().filter(c => /[a-z0-9-]/.test(c)), { minLength: 3, maxLength: 20 }),
            domain: fc.domain()
          }),
          async (siteConfig) => {
          // Setup test environment without creating data files
          const dataDir = path.join(tempDir, 'data');
          const outputDir = path.join(tempDir, 'output');
          await fs.mkdir(dataDir, { recursive: true });

          // Create dashboard instance
          const dashboard = new StaticDashboard({
            dataDir,
            outputDir,
            sites: [siteConfig]
          });

          // Generate dashboard (should handle missing data gracefully)
          const result = await dashboard.generateDashboard();

          // Verify generation success
          expect(result.success).toBe(true);

          // Read generated index HTML
          const indexHTML = await fs.readFile(path.join(outputDir, 'index.html'), 'utf8');

          // Property: Missing data should show error state
          expect(indexHTML).toMatch(/Data unavailable|error/i);
          expect(indexHTML).toContain(siteConfig.domain);

          // Property: Error cards should have appropriate styling
          expect(indexHTML).toMatch(/class="[^"]*error[^"]*"/);
        }),
        { numRuns: 30, timeout: 15000 }
      );
    });
  });

  /**
   * Validate index page structure contains required elements
   */
  function validateIndexPageStructure(html, analyticsData, siteConfig) {
    // Must be valid HTML document
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');

    // Must contain title and meta tags
    expect(html).toContain('<title>');
    expect(html).toContain('viewport');

    // Must contain main dashboard elements
    expect(html).toContain('Metrona Analytics Dashboard');
    expect(html).toContain('overview-cards');
    expect(html).toContain('sites-section');

    // Must display site information
    expect(html).toContain(siteConfig.domain);

    // Must include CSS and JS references
    expect(html).toContain('styles.css');
    expect(html).toContain('dashboard.js');

    // Must show aggregate statistics
    expect(html).toMatch(/Total Sites/);
    expect(html).toMatch(/Total Pageviews/);
    expect(html).toMatch(/Unique Visitors/);
  }

  /**
   * Validate site page structure contains required elements
   */
  function validateSitePageStructure(html, analyticsData, siteConfig) {
    // Must be valid HTML document
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');

    // Must contain site-specific title
    expect(html).toContain(siteConfig.domain);

    // Must contain navigation
    expect(html).toContain('← Dashboard');
    expect(html).toContain('index.html');

    // Must display summary metrics
    expect(html).toMatch(/Total Pageviews/);
    expect(html).toMatch(/Unique Visitors/);

    // Must contain main sections
    expect(html).toMatch(/Top Pages/);
    expect(html).toMatch(/Top Referrers/);
    expect(html).toMatch(/Traffic Trends/);

    // If data exists, must display it properly
    if (analyticsData.top_pages && analyticsData.top_pages.length > 0) {
      expect(html).toContain('<table');
      expect(html).toContain('data-table');
    }

    if (analyticsData.referrers.by_domain && analyticsData.referrers.by_domain.length > 0) {
      expect(html).toContain('<table');
    }

    if (analyticsData.time_series.daily && analyticsData.time_series.daily.length > 0) {
      expect(html).toContain('<canvas');
      expect(html).toContain('window.chartData');
    }
  }

  /**
   * Validate HTML structure is well-formed
   */
  function validateHTMLStructure(html) {
    // Must have proper DOCTYPE
    expect(html).toMatch(/^<!DOCTYPE html>/);

    // Must have required meta tags
    expect(html).toContain('charset="UTF-8"');
    expect(html).toContain('viewport');

    // Must have proper head and body structure
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');

    // Must have container structure
    expect(html).toContain('class="container"');
    expect(html).toContain('class="header"');
    expect(html).toContain('class="footer"');

    // Must not have unclosed tags (basic check)
    const openTags = (html.match(/<[^/][^>]*>/g) || []).length;
    const closeTags = (html.match(/<\/[^>]*>/g) || []).length;
    const selfClosingTags = (html.match(/<[^>]*\/>/g) || []).length;
    
    // Allow for some self-closing tags and meta tags
    expect(Math.abs(openTags - closeTags - selfClosingTags)).toBeLessThan(10);
  }

  /**
   * Validate numeric formatting is consistent
   */
  function validateNumericFormatting(html, analyticsData) {
    const summary = analyticsData.summary || {};
    
    // Check that large numbers are formatted with commas
    if (summary.total_pageviews >= 1000) {
      const formatted = summary.total_pageviews.toLocaleString();
      expect(html).toContain(formatted);
    }

    if (summary.unique_visitors >= 1000) {
      const formatted = summary.unique_visitors.toLocaleString();
      expect(html).toContain(formatted);
    }

    // Check percentage formatting (only if this is a site detail page with tables)
    if (html.includes('data-table') && analyticsData.top_pages) {
      analyticsData.top_pages.forEach(page => {
        if (page.percentage !== undefined) {
          const formatted = page.percentage.toFixed(1) + '%';
          expect(html).toContain(formatted);
        }
      });
    }
  }

  /**
   * Validate HTML escaping for security
   */
  function validateHTMLEscaping(html, analyticsData) {
    // Check that paths are properly escaped
    if (analyticsData.top_pages) {
      analyticsData.top_pages.forEach(page => {
        if (page.path.includes('<') || page.path.includes('>') || page.path.includes('&')) {
          // Should not contain raw HTML characters
          expect(html).not.toContain(`>${page.path}<`);
          // Should contain escaped versions
          if (page.path.includes('<')) {
            expect(html).toContain('&lt;');
          }
          if (page.path.includes('>')) {
            expect(html).toContain('&gt;');
          }
          if (page.path.includes('&')) {
            expect(html).toContain('&amp;');
          }
        }
      });
    }

    // Check that referrer domains are properly escaped
    if (analyticsData.referrers && analyticsData.referrers.by_domain) {
      analyticsData.referrers.by_domain.forEach(referrer => {
        if (referrer.domain.includes('<') || referrer.domain.includes('>')) {
          expect(html).not.toContain(`>${referrer.domain}<`);
        }
      });
    }
  }
});