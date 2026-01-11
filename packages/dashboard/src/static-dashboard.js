/**
 * @fileoverview Static Dashboard for Metrona Analytics System
 * Provides HTML/CSS/JS interface for viewing analytics data from YAML files
 * Includes date range filtering and CSV export functionality
 * Validates Requirements 5.1, 5.2, 5.3, 5.5, 5.6
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

class StaticDashboard {
  constructor(options = {}) {
    this.dataDir = options.dataDir || './data';
    this.outputDir = options.outputDir || './public';
    this.templateDir = options.templateDir || path.join(__dirname, '../templates');
    this.sites = options.sites || [];
  }

  /**
   * Generate complete static dashboard
   * @returns {Promise<Object>} Generation result
   */
  async generateDashboard() {
    try {
      console.log('🎨 Generating static dashboard...');
      
      // Ensure output directory exists
      await fs.mkdir(this.outputDir, { recursive: true });
      
      // Load analytics data for all sites
      const siteData = await this.loadAllSiteData();
      
      // Generate HTML files
      await this.generateIndexPage(siteData);
      await this.generateSitePages(siteData);
      
      // Copy static assets
      await this.copyStaticAssets();
      
      console.log('✅ Static dashboard generated in: ' + this.outputDir);
      
      return {
        success: true,
        outputDir: this.outputDir,
        sites: Object.keys(siteData),
        files: await this.getGeneratedFiles()
      };
      
    } catch (error) {
      throw new Error('Dashboard generation failed: ' + error.message);
    }
  }

  /**
   * Load analytics data for all configured sites
   * @returns {Promise<Object>} Site data indexed by site ID
   */
  async loadAllSiteData() {
    const siteData = {};
    
    for (const siteConfig of this.sites) {
      try {
        const data = await this.loadSiteData(siteConfig.siteId);
        siteData[siteConfig.siteId] = {
          config: siteConfig,
          data: data,
          lastUpdated: data.metadata?.generated_at || new Date().toISOString()
        };
      } catch (error) {
        console.warn('⚠️  Failed to load data for site ' + siteConfig.siteId + ': ' + error.message);
        siteData[siteConfig.siteId] = {
          config: siteConfig,
          data: null,
          error: error.message,
          lastUpdated: new Date().toISOString()
        };
      }
    }
    
    return siteData;
  }

  /**
   * Load analytics data for a specific site
   * @param {string} siteId - Site identifier
   * @returns {Promise<Object>} Parsed YAML data
   */
  async loadSiteData(siteId) {
    const yamlPath = path.join(this.dataDir, siteId + '.yaml');
    
    try {
      const yamlContent = await fs.readFile(yamlPath, 'utf8');
      const data = yaml.load(yamlContent);
      
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid YAML data structure');
      }
      
      return data;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('Analytics data file not found: ' + yamlPath);
      }
      throw new Error('Failed to parse YAML data: ' + error.message);
    }
  }

  /**
   * Generate main dashboard index page
   * @param {Object} siteData - All site data
   * @returns {Promise<void>}
   */
  async generateIndexPage(siteData) {
    const html = this.generateIndexHTML(siteData);
    const indexPath = path.join(this.outputDir, 'index.html');
    await fs.writeFile(indexPath, html, 'utf8');
    console.log('✅ Generated index page: ' + indexPath);
  }

  /**
   * Generate individual site detail pages
   * @param {Object} siteData - All site data
   * @returns {Promise<void>}
   */
  async generateSitePages(siteData) {
    for (const [siteId, site] of Object.entries(siteData)) {
      if (site.data) {
        const html = this.generateSiteHTML(siteId, site);
        const sitePath = path.join(this.outputDir, siteId + '.html');
        await fs.writeFile(sitePath, html, 'utf8');
        console.log('✅ Generated site page: ' + sitePath);
      }
    }
  }

  /**
   * Generate HTML for main dashboard index
   * @param {Object} siteData - All site data
   * @returns {string} HTML content
   */
  generateIndexHTML(siteData) {
    const sites = Object.entries(siteData);
    const totalSites = sites.length;
    const activeSites = sites.filter(([_, site]) => site.data).length;
    
    // Calculate aggregate statistics
    let totalPageviews = 0;
    let totalUniqueVisitors = 0;
    
    sites.forEach(([_, site]) => {
      if (site.data && site.data.summary) {
        totalPageviews += site.data.summary.total_pageviews || 0;
        totalUniqueVisitors += site.data.summary.unique_visitors || 0;
      }
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Metrona Analytics Dashboard</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>📊 Metrona Analytics Dashboard</h1>
            <p class="subtitle">Privacy-focused web analytics for all your sites</p>
        </header>

        <div class="overview-cards">
            <div class="card">
                <h3>Total Sites</h3>
                <div class="metric">${totalSites}</div>
                <div class="sub-metric">${activeSites} active</div>
            </div>
            <div class="card">
                <h3>Total Pageviews</h3>
                <div class="metric">${totalPageviews.toLocaleString()}</div>
                <div class="sub-metric">All sites combined</div>
            </div>
            <div class="card">
                <h3>Unique Visitors</h3>
                <div class="metric">${totalUniqueVisitors.toLocaleString()}</div>
                <div class="sub-metric">Privacy-preserved</div>
            </div>
        </div>

        <div class="sites-section">
            <h2>Sites Overview</h2>
            <div class="sites-grid">
                ${sites.map(([siteId, site]) => this.generateSiteCard(siteId, site)).join('')}
            </div>
        </div>

        <footer class="footer">
            <p>Generated at ${new Date().toLocaleString()}</p>
            <p>Metrona Analytics System - Privacy-focused analytics</p>
        </footer>
    </div>

    <script src="dashboard.js"></script>
</body>
</html>`;
  }

  /**
   * Generate HTML card for a site on the index page
   * @param {string} siteId - Site identifier
   * @param {Object} site - Site data and config
   * @returns {string} HTML content for site card
   */
  generateSiteCard(siteId, site) {
    if (!site.data) {
      return `
        <div class="site-card error">
            <h3>${site.config.domain || siteId}</h3>
            <div class="error-message">
                <span class="status-indicator error">●</span>
                Data unavailable
            </div>
            <p class="error-details">${site.error || 'No data found'}</p>
            <div class="last-updated">Last checked: ${new Date(site.lastUpdated).toLocaleString()}</div>
        </div>`;
    }

    const summary = site.data.summary || {};
    const pageviews = summary.total_pageviews || 0;
    const visitors = summary.unique_visitors || 0;
    const topPage = summary.top_pages && summary.top_pages[0] ? summary.top_pages[0] : null;

    return `
        <div class="site-card" onclick="window.location.href='${siteId}.html'">
            <h3>${site.config.domain || siteId}</h3>
            <div class="site-metrics">
                <div class="metric-row">
                    <span class="status-indicator active">●</span>
                    <span>${pageviews.toLocaleString()} pageviews</span>
                </div>
                <div class="metric-row">
                    <span>👥 ${visitors.toLocaleString()} visitors</span>
                </div>
                ${topPage ? `<div class="metric-row">
                    <span>🔥 ${topPage.path} (${topPage.pageviews})</span>
                </div>` : ''}
            </div>
            <div class="last-updated">Updated: ${new Date(site.lastUpdated).toLocaleString()}</div>
        </div>`;
  }

  /**
   * Generate HTML for individual site page
   * @param {string} siteId - Site identifier
   * @param {Object} site - Site data and config
   * @returns {string} HTML content
   */
  generateSiteHTML(siteId, site) {
    const data = site.data;
    const summary = data.summary || {};
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${site.config.domain || siteId} - Analytics</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <header class="header">
            <nav class="breadcrumb">
                <a href="index.html">← Dashboard</a>
            </nav>
            <h1>📈 ${site.config.domain || siteId}</h1>
            <p class="subtitle">Analytics Overview</p>
        </header>

        <div class="controls-section">
            <div class="date-range-controls">
                <label for="dateRange">Date Range:</label>
                <select id="dateRange" onchange="filterByDateRange(this.value)">
                    <option value="all">All Time</option>
                    <option value="1d">Last 24 Hours</option>
                    <option value="7d">Last 7 Days</option>
                    <option value="30d">Last 30 Days</option>
                    <option value="1y">Last Year</option>
                </select>
            </div>
            <div class="export-controls">
                <button onclick="exportData('summary')" class="export-btn">📊 Export Summary</button>
                <button onclick="exportData('pages')" class="export-btn">📄 Export Pages</button>
                <button onclick="exportData('referrers')" class="export-btn">🔗 Export Referrers</button>
                <button onclick="exportData('timeseries')" class="export-btn">📈 Export Time Series</button>
            </div>
        </div>

        <div class="overview-cards">
            <div class="card">
                <h3>Total Pageviews</h3>
                <div class="metric" id="totalPageviews">${(summary.total_pageviews || 0).toLocaleString()}</div>
            </div>
            <div class="card">
                <h3>Unique Visitors</h3>
                <div class="metric" id="uniqueVisitors">${(summary.unique_visitors || 0).toLocaleString()}</div>
            </div>
            <div class="card">
                <h3>Top Page</h3>
                <div class="metric-small" id="topPage">${summary.top_pages && summary.top_pages[0] ? summary.top_pages[0].path : 'N/A'}</div>
                <div class="sub-metric" id="topPageViews">${summary.top_pages && summary.top_pages[0] ? summary.top_pages[0].pageviews + ' views' : ''}</div>
            </div>
        </div>

        <div id="contentSections">
            ${this.generateTopPagesSection(data.top_pages)}
            ${this.generateReferrersSection(data.referrers)}
            ${this.generateTimeSeriesSection(data.time_series)}
        </div>

        <footer class="footer">
            <p>Last updated: ${new Date(site.lastUpdated).toLocaleString()}</p>
            <p>Data generated at: ${data.metadata?.generated_at ? new Date(data.metadata.generated_at).toLocaleString() : 'Unknown'}</p>
        </footer>
    </div>

    <script>
        // Embed full site data for JavaScript processing
        window.siteData = ${JSON.stringify(data)};
        window.siteId = '${siteId}';
    </script>
    <script src="dashboard.js"></script>
</body>
</html>`;
  }

  /**
   * Generate top pages section HTML
   * @param {Array} topPages - Top pages data
   * @returns {string} HTML content
   */
  generateTopPagesSection(topPages) {
    if (!topPages || !Array.isArray(topPages) || topPages.length === 0) {
      return '<div class="section"><h2>Top Pages</h2><p>No page data available</p></div>';
    }

    return `
        <div class="section">
            <h2>🔥 Top Pages</h2>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Page</th>
                            <th>Pageviews</th>
                            <th>Unique Visitors</th>
                            <th>Share</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topPages.slice(0, 10).map(page => `
                            <tr>
                                <td class="page-path">${this.escapeHtml(page.path)}</td>
                                <td>${page.pageviews.toLocaleString()}</td>
                                <td>${page.unique_visitors.toLocaleString()}</td>
                                <td>${page.percentage.toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
  }

  /**
   * Generate referrers section HTML
   * @param {Object} referrers - Referrers data
   * @returns {string} HTML content
   */
  generateReferrersSection(referrers) {
    if (!referrers || !referrers.by_domain || !Array.isArray(referrers.by_domain) || referrers.by_domain.length === 0) {
      return '<div class="section"><h2>Top Referrers</h2><p>No referrer data available</p></div>';
    }

    return `
        <div class="section">
            <h2>🔗 Top Referrers</h2>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Domain</th>
                            <th>Visits</th>
                            <th>Unique Visitors</th>
                            <th>Share</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${referrers.by_domain.slice(0, 10).map(referrer => `
                            <tr>
                                <td class="referrer-domain">${this.escapeHtml(referrer.domain)}</td>
                                <td>${referrer.visits.toLocaleString()}</td>
                                <td>${referrer.unique_visitors.toLocaleString()}</td>
                                <td>${referrer.percentage.toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
  }

  /**
   * Generate time series section HTML
   * @param {Object} timeSeries - Time series data
   * @returns {string} HTML content
   */
  generateTimeSeriesSection(timeSeries) {
    if (!timeSeries || !timeSeries.daily || !Array.isArray(timeSeries.daily) || timeSeries.daily.length === 0) {
      return '<div class="section"><h2>Traffic Trends</h2><p>No time series data available</p></div>';
    }

    // Get recent data (last 30 days)
    const recentData = timeSeries.daily.slice(-30);
    
    return `
        <div class="section">
            <h2>📊 Traffic Trends (Last 30 Days)</h2>
            <div class="chart-container">
                <canvas id="trafficChart" width="800" height="300"></canvas>
            </div>
            <div class="chart-legend">
                <span class="legend-item">
                    <span class="legend-color pageviews"></span>
                    Pageviews
                </span>
                <span class="legend-item">
                    <span class="legend-color visitors"></span>
                    Unique Visitors
                </span>
            </div>
        </div>
        
        <script>
            // Embed chart data for JavaScript
            window.chartData = ${JSON.stringify(recentData)};
        </script>`;
  }

  /**
   * Copy static assets (CSS, JS) to output directory
   * @returns {Promise<void>}
   */
  async copyStaticAssets() {
    // Generate CSS
    const css = this.generateCSS();
    await fs.writeFile(path.join(this.outputDir, 'styles.css'), css, 'utf8');
    
    // Generate JavaScript
    const js = this.generateJavaScript();
    await fs.writeFile(path.join(this.outputDir, 'dashboard.js'), js, 'utf8');
    
    console.log('✅ Generated static assets (CSS, JS)');
  }

  /**
   * Generate CSS styles for the dashboard
   * @returns {string} CSS content
   */
  generateCSS() {
    return `/* Metrona Analytics Dashboard Styles */

/* Reset and base styles */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    line-height: 1.6;
    color: #333;
    background-color: #f8fafc;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}

/* Header */
.header {
    text-align: center;
    margin-bottom: 40px;
}

.header h1 {
    font-size: 2.5rem;
    color: #1a202c;
    margin-bottom: 10px;
}

.subtitle {
    font-size: 1.1rem;
    color: #718096;
}

.breadcrumb {
    text-align: left;
    margin-bottom: 20px;
}

.breadcrumb a {
    color: #4299e1;
    text-decoration: none;
    font-weight: 500;
}

.breadcrumb a:hover {
    text-decoration: underline;
}

/* Controls section */
.controls-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: white;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border: 1px solid #e2e8f0;
    flex-wrap: wrap;
    gap: 16px;
}

.date-range-controls {
    display: flex;
    align-items: center;
    gap: 12px;
}

.date-range-controls label {
    font-weight: 600;
    color: #4a5568;
}

.date-range-controls select {
    padding: 8px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: white;
    color: #2d3748;
    font-size: 0.9rem;
    cursor: pointer;
}

.date-range-controls select:focus {
    outline: none;
    border-color: #4299e1;
    box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.1);
}

.export-controls {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.export-btn {
    padding: 8px 16px;
    background: #4299e1;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.export-btn:hover {
    background: #3182ce;
}

.export-btn:active {
    transform: translateY(1px);
}

/* Cards */
.overview-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
    margin-bottom: 40px;
}

.card {
    background: white;
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border: 1px solid #e2e8f0;
}

.card h3 {
    font-size: 0.9rem;
    font-weight: 600;
    color: #718096;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
}

.metric {
    font-size: 2.5rem;
    font-weight: 700;
    color: #1a202c;
    line-height: 1;
}

.metric-small {
    font-size: 1.2rem;
    font-weight: 600;
    color: #1a202c;
    line-height: 1.2;
}

.sub-metric {
    font-size: 0.9rem;
    color: #718096;
    margin-top: 4px;
}

/* Sites grid */
.sites-section {
    margin-bottom: 40px;
}

.sites-section h2 {
    font-size: 1.8rem;
    color: #1a202c;
    margin-bottom: 24px;
}

.sites-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
}

.site-card {
    background: white;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border: 1px solid #e2e8f0;
    cursor: pointer;
    transition: all 0.2s ease;
}

.site-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.site-card.error {
    border-color: #fed7d7;
    background-color: #fef5e7;
    cursor: default;
}

.site-card.error:hover {
    transform: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.site-card h3 {
    font-size: 1.2rem;
    color: #1a202c;
    margin-bottom: 12px;
}

.site-metrics {
    margin-bottom: 12px;
}

.metric-row {
    display: flex;
    align-items: center;
    margin-bottom: 6px;
    font-size: 0.9rem;
    color: #4a5568;
}

.status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 8px;
}

.status-indicator.active {
    color: #48bb78;
}

.status-indicator.error {
    color: #f56565;
}

.last-updated {
    font-size: 0.8rem;
    color: #a0aec0;
}

.error-message {
    color: #e53e3e;
    font-weight: 500;
    margin-bottom: 8px;
}

.error-details {
    font-size: 0.9rem;
    color: #718096;
    margin-bottom: 12px;
}

/* Sections */
.section {
    background: white;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border: 1px solid #e2e8f0;
}

.section h2 {
    font-size: 1.5rem;
    color: #1a202c;
    margin-bottom: 20px;
}

/* Tables */
.table-container {
    overflow-x: auto;
}

.data-table {
    width: 100%;
    border-collapse: collapse;
}

.data-table th {
    background-color: #f7fafc;
    padding: 12px;
    text-align: left;
    font-weight: 600;
    color: #4a5568;
    border-bottom: 2px solid #e2e8f0;
}

.data-table td {
    padding: 12px;
    border-bottom: 1px solid #e2e8f0;
}

.data-table tr:hover {
    background-color: #f7fafc;
}

.page-path {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 0.9rem;
    color: #4299e1;
}

.referrer-domain {
    font-weight: 500;
    color: #2d3748;
}

/* Charts */
.chart-container {
    margin: 20px 0;
    text-align: center;
}

.chart-legend {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin-top: 16px;
}

.legend-item {
    display: flex;
    align-items: center;
    font-size: 0.9rem;
    color: #4a5568;
}

.legend-color {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    margin-right: 6px;
}

.legend-color.pageviews {
    background-color: #4299e1;
}

.legend-color.visitors {
    background-color: #48bb78;
}

/* Footer */
.footer {
    text-align: center;
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid #e2e8f0;
    color: #718096;
    font-size: 0.9rem;
}

/* Responsive design */
@media (max-width: 768px) {
    .container {
        padding: 16px;
    }
    
    .header h1 {
        font-size: 2rem;
    }
    
    .controls-section {
        flex-direction: column;
        align-items: stretch;
    }
    
    .date-range-controls {
        justify-content: center;
    }
    
    .export-controls {
        justify-content: center;
    }
    
    .overview-cards {
        grid-template-columns: 1fr;
        gap: 16px;
    }
    
    .sites-grid {
        grid-template-columns: 1fr;
        gap: 16px;
    }
    
    .metric {
        font-size: 2rem;
    }
    
    .data-table {
        font-size: 0.9rem;
    }
    
    .data-table th,
    .data-table td {
        padding: 8px;
    }
}

@media (max-width: 480px) {
    .header h1 {
        font-size: 1.8rem;
    }
    
    .controls-section {
        padding: 16px;
    }
    
    .export-controls {
        flex-direction: column;
    }
    
    .export-btn {
        width: 100%;
        margin-bottom: 8px;
    }
    
    .metric {
        font-size: 1.8rem;
    }
    
    .card {
        padding: 16px;
    }
    
    .section {
        padding: 16px;
    }
}`;
  }

  /**
   * Generate JavaScript for the dashboard
   * @returns {string} JavaScript content
   */
  generateJavaScript() {
    return `// Metrona Analytics Dashboard JavaScript

document.addEventListener('DOMContentLoaded', function() {
    console.log('📊 Metrona Analytics Dashboard loaded');
    
    // Initialize chart if data is available
    if (typeof window.chartData !== 'undefined') {
        initializeChart();
    }
    
    // Add click handlers for interactive elements
    initializeInteractions();
});

/**
 * Filter data by date range and update display
 * @param {string} range - Date range selection
 */
function filterByDateRange(range) {
    if (!window.siteData) return;
    
    console.log('Filtering data by range:', range);
    
    const filteredData = filterDataByDateRange(window.siteData, range);
    updateDisplayWithFilteredData(filteredData);
    
    // Update chart if available
    if (filteredData.time_series && filteredData.time_series.daily) {
        window.chartData = filteredData.time_series.daily.slice(-30);
        initializeChart();
    }
}

/**
 * Filter analytics data by date range (client-side implementation)
 * @param {Object} data - Analytics data
 * @param {string} range - Date range ('1d', '7d', '30d', '1y', 'all')
 * @returns {Object} Filtered data
 */
function filterDataByDateRange(data, range = 'all') {
    if (!data || range === 'all') {
        return data;
    }

    const now = new Date();
    let startDate;

    switch (range) {
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
        default:
            return data;
    }

    const filteredData = JSON.parse(JSON.stringify(data)); // Deep clone

    // Filter time series data
    if (data.time_series && data.time_series.daily) {
        filteredData.time_series.daily = data.time_series.daily.filter(entry => {
            const entryDate = new Date(entry.date);
            return entryDate >= startDate && entryDate <= now;
        });

        // Recalculate summary statistics
        const dailyData = filteredData.time_series.daily;
        if (dailyData.length > 0) {
            filteredData.summary = {
                ...filteredData.summary,
                total_pageviews: dailyData.reduce((sum, day) => sum + (day.pageviews || 0), 0),
                unique_visitors: Math.max(...dailyData.map(day => day.unique_visitors || 0), 0),
                date_range: range
            };
        }
    }

    return filteredData;
}

/**
 * Update display with filtered data
 * @param {Object} data - Filtered analytics data
 */
function updateDisplayWithFilteredData(data) {
    const summary = data.summary || {};
    
    // Update summary cards
    const totalPageviews = document.getElementById('totalPageviews');
    const uniqueVisitors = document.getElementById('uniqueVisitors');
    
    if (totalPageviews) {
        totalPageviews.textContent = (summary.total_pageviews || 0).toLocaleString();
    }
    
    if (uniqueVisitors) {
        uniqueVisitors.textContent = (summary.unique_visitors || 0).toLocaleString();
    }
    
    // Update content sections
    const contentSections = document.getElementById('contentSections');
    if (contentSections) {
        contentSections.innerHTML = 
            generateTopPagesSection(data.top_pages) +
            generateReferrersSection(data.referrers) +
            generateTimeSeriesSection(data.time_series);
    }
}

/**
 * Export data in CSV format
 * @param {string} type - Export type ('summary', 'pages', 'referrers', 'timeseries')
 */
function exportData(type) {
    if (!window.siteData) {
        alert('No data available for export');
        return;
    }
    
    try {
        const currentRange = document.getElementById('dateRange').value;
        const filteredData = filterDataByDateRange(window.siteData, currentRange);
        const csv = generateCSVExport(filteredData, type);
        
        // Create and download file
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', window.siteId + '-' + type + '-' + currentRange + '.csv');
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        console.log('Exported ' + type + ' data for range ' + currentRange);
        
    } catch (error) {
        console.error('Export failed:', error);
        alert('Export failed: ' + error.message);
    }
}

/**
 * Generate CSV export for analytics data (client-side implementation)
 * @param {Object} data - Analytics data
 * @param {string} type - Export type
 * @returns {string} CSV content
 */
function generateCSVExport(data, type) {
    switch (type) {
        case 'summary':
            return generateSummaryCSV(data);
        case 'pages':
            return generatePagesCSV(data.top_pages);
        case 'referrers':
            return generateReferrersCSV(data.referrers);
        case 'timeseries':
            return generateTimeSeriesCSV(data.time_series);
        default:
            throw new Error('Unknown export type: ' + type);
    }
}

/**
 * Generate summary CSV (client-side)
 */
function generateSummaryCSV(data) {
    const summary = data.summary || {};
    const metadata = data.metadata || {};
    
    const rows = [
        ['Metric', 'Value'],
        ['Site', metadata.site || 'Unknown'],
        ['Generated At', metadata.generated_at || 'Unknown'],
        ['Total Pageviews', summary.total_pageviews || 0],
        ['Unique Visitors', summary.unique_visitors || 0],
        ['Top Page', summary.top_pages && summary.top_pages[0] ? summary.top_pages[0].path : 'N/A'],
        ['Date Range', summary.date_range || 'all']
    ];

    return arrayToCSV(rows);
}

/**
 * Generate pages CSV (client-side)
 */
function generatePagesCSV(pages) {
    if (!pages || !Array.isArray(pages)) {
        return 'Path,Pageviews,Unique Visitors,Percentage\n';
    }

    const rows = [['Path', 'Pageviews', 'Unique Visitors', 'Percentage']];
    
    pages.forEach(page => {
        rows.push([
            page.path || '',
            page.pageviews || 0,
            page.unique_visitors || 0,
            (page.percentage || 0).toFixed(2) + '%'
        ]);
    });

    return arrayToCSV(rows);
}

/**
 * Generate referrers CSV (client-side)
 */
function generateReferrersCSV(referrers) {
    if (!referrers || !referrers.by_domain || !Array.isArray(referrers.by_domain)) {
        return 'Domain,Visits,Unique Visitors,Percentage\n';
    }

    const rows = [['Domain', 'Visits', 'Unique Visitors', 'Percentage']];
    
    referrers.by_domain.forEach(referrer => {
        rows.push([
            referrer.domain || '',
            referrer.visits || 0,
            referrer.unique_visitors || 0,
            (referrer.percentage || 0).toFixed(2) + '%'
        ]);
    });

    return arrayToCSV(rows);
}

/**
 * Generate time series CSV (client-side)
 */
function generateTimeSeriesCSV(timeSeries) {
    if (!timeSeries || !timeSeries.daily || !Array.isArray(timeSeries.daily)) {
        return 'Date,Pageviews,Unique Visitors\n';
    }

    const rows = [['Date', 'Pageviews', 'Unique Visitors']];
    
    timeSeries.daily.forEach(entry => {
        rows.push([
            entry.date || '',
            entry.pageviews || 0,
            entry.unique_visitors || 0
        ]);
    });

    return arrayToCSV(rows);
}

/**
 * Convert array to CSV format (client-side)
 */
function arrayToCSV(rows) {
    return rows.map(row => 
        row.map(cell => {
            const cellStr = String(cell);
            if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                return '"' + cellStr.replace(/"/g, '""') + '"';
            }
            return cellStr;
        }).join(',')
    ).join('\n');
}

/**
 * Generate HTML sections (client-side implementations for dynamic updates)
 */
function generateTopPagesSection(topPages) {
    if (!topPages || !Array.isArray(topPages) || topPages.length === 0) {
        return '<div class="section"><h2>🔥 Top Pages</h2><p>No page data available</p></div>';
    }

    var tableRows = topPages.slice(0, 10).map(function(page) {
        return '<tr>' +
            '<td class="page-path">' + escapeHtml(page.path) + '</td>' +
            '<td>' + page.pageviews.toLocaleString() + '</td>' +
            '<td>' + page.unique_visitors.toLocaleString() + '</td>' +
            '<td>' + page.percentage.toFixed(1) + '%</td>' +
            '</tr>';
    }).join('');

    return '<div class="section">' +
        '<h2>🔥 Top Pages</h2>' +
        '<div class="table-container">' +
            '<table class="data-table">' +
                '<thead>' +
                    '<tr>' +
                        '<th>Page</th>' +
                        '<th>Pageviews</th>' +
                        '<th>Unique Visitors</th>' +
                        '<th>Share</th>' +
                    '</tr>' +
                '</thead>' +
                '<tbody>' + tableRows + '</tbody>' +
            '</table>' +
        '</div>' +
    '</div>';
}

function generateReferrersSection(referrers) {
    if (!referrers || !referrers.by_domain || !Array.isArray(referrers.by_domain) || referrers.by_domain.length === 0) {
        return '<div class="section"><h2>🔗 Top Referrers</h2><p>No referrer data available</p></div>';
    }

    var tableRows = referrers.by_domain.slice(0, 10).map(function(referrer) {
        return '<tr>' +
            '<td class="referrer-domain">' + escapeHtml(referrer.domain) + '</td>' +
            '<td>' + referrer.visits.toLocaleString() + '</td>' +
            '<td>' + referrer.unique_visitors.toLocaleString() + '</td>' +
            '<td>' + referrer.percentage.toFixed(1) + '%</td>' +
            '</tr>';
    }).join('');

    return '<div class="section">' +
        '<h2>🔗 Top Referrers</h2>' +
        '<div class="table-container">' +
            '<table class="data-table">' +
                '<thead>' +
                    '<tr>' +
                        '<th>Domain</th>' +
                        '<th>Visits</th>' +
                        '<th>Unique Visitors</th>' +
                        '<th>Share</th>' +
                    '</tr>' +
                '</thead>' +
                '<tbody>' + tableRows + '</tbody>' +
            '</table>' +
        '</div>' +
    '</div>';
}

function generateTimeSeriesSection(timeSeries) {
    if (!timeSeries || !timeSeries.daily || !Array.isArray(timeSeries.daily) || timeSeries.daily.length === 0) {
        return '<div class="section"><h2>📊 Traffic Trends</h2><p>No time series data available</p></div>';
    }

    return '<div class="section">' +
        '<h2>📊 Traffic Trends</h2>' +
        '<div class="chart-container">' +
            '<canvas id="trafficChart" width="800" height="300"></canvas>' +
        '</div>' +
        '<div class="chart-legend">' +
            '<span class="legend-item">' +
                '<span class="legend-color pageviews"></span>' +
                'Pageviews' +
            '</span>' +
            '<span class="legend-item">' +
                '<span class="legend-color visitors"></span>' +
                'Unique Visitors' +
            '</span>' +
        '</div>' +
    '</div>';
}

/**
 * Initialize traffic chart
 */
function initializeChart() {
    const canvas = document.getElementById('trafficChart');
    if (!canvas || !window.chartData) return;
    
    const ctx = canvas.getContext('2d');
    const data = window.chartData;
    
    // Simple canvas-based chart implementation
    drawChart(ctx, data, canvas.width, canvas.height);
}

/**
 * Draw a simple line chart on canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} data - Chart data
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
function drawChart(ctx, data, width, height) {
    if (!data || data.length === 0) return;
    
    const padding = 60;
    const chartWidth = width - (padding * 2);
    const chartHeight = height - (padding * 2);
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Get data ranges
    const maxPageviews = Math.max(...data.map(d => d.pageviews || 0));
    const maxVisitors = Math.max(...data.map(d => d.unique_visitors || 0));
    const maxValue = Math.max(maxPageviews, maxVisitors);
    
    if (maxValue === 0) return;
    
    // Draw grid lines
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    
    // Horizontal grid lines
    for (let i = 0; i <= 5; i++) {
        const y = padding + (chartHeight * i / 5);
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        
        // Y-axis labels
        const value = Math.round(maxValue * (5 - i) / 5);
        ctx.fillStyle = '#718096';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(value.toLocaleString(), padding - 10, y + 4);
    }
    
    // Draw pageviews line
    ctx.strokeStyle = '#4299e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    data.forEach((point, index) => {
        const x = padding + (chartWidth * index / (data.length - 1));
        const y = padding + chartHeight - (chartHeight * (point.pageviews || 0) / maxValue);
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    
    // Draw visitors line
    ctx.strokeStyle = '#48bb78';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    data.forEach((point, index) => {
        const x = padding + (chartWidth * index / (data.length - 1));
        const y = padding + chartHeight - (chartHeight * (point.unique_visitors || 0) / maxValue);
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    
    // Draw X-axis labels (show every 5th day)
    ctx.fillStyle = '#718096';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    
    data.forEach((point, index) => {
        if (index % 5 === 0 || index === data.length - 1) {
            const x = padding + (chartWidth * index / (data.length - 1));
            const date = new Date(point.date);
            const label = (date.getMonth() + 1) + '/' + date.getDate();
            ctx.fillText(label, x, height - padding + 20);
        }
    });
}

/**
 * Initialize interactive elements
 */
function initializeInteractions() {
    // Add hover effects for site cards
    const siteCards = document.querySelectorAll('.site-card:not(.error)');
    siteCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // Add table row highlighting
    const tableRows = document.querySelectorAll('.data-table tbody tr');
    tableRows.forEach(row => {
        row.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#f7fafc';
        });
        
        row.addEventListener('mouseleave', function() {
            this.style.backgroundColor = '';
        });
    });
}

/**
 * Utility function to format numbers
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

/**
 * Utility function to escape HTML
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}`;
  }

  /**
   * Get list of generated files
   * @returns {Promise<Array>} List of generated files
   */
  async getGeneratedFiles() {
    try {
      const files = await fs.readdir(this.outputDir);
      return files.filter(file => file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.js'));
    } catch (error) {
      return [];
    }
  }

  /**
   * Filter analytics data by date range
   * @param {Object} data - Analytics data
   * @param {string} range - Date range ('1d', '7d', '30d', '1y', 'all')
   * @returns {Object} Filtered data
   */
  filterDataByDateRange(data, range = 'all') {
    if (!data || range === 'all') {
      return data;
    }

    const now = new Date();
    let startDate;

    switch (range) {
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
      default:
        return data;
    }

    const filteredData = { ...data };

    // Filter time series data
    if (data.time_series) {
      filteredData.time_series = {};
      
      if (data.time_series.daily) {
        filteredData.time_series.daily = data.time_series.daily.filter(entry => {
          const entryDate = new Date(entry.date);
          return entryDate >= startDate && entryDate <= now;
        });
      }

      if (data.time_series.hourly) {
        filteredData.time_series.hourly = data.time_series.hourly.filter(entry => {
          const entryDate = new Date(entry.timestamp);
          return entryDate >= startDate && entryDate <= now;
        });
      }
    }

    // Recalculate summary statistics for filtered data
    if (filteredData.time_series && filteredData.time_series.daily) {
      const dailyData = filteredData.time_series.daily;
      filteredData.summary = {
        ...filteredData.summary,
        total_pageviews: dailyData.reduce((sum, day) => sum + (day.pageviews || 0), 0),
        unique_visitors: Math.max(...dailyData.map(day => day.unique_visitors || 0), 0),
        date_range: range,
        filtered_period: {
          start: startDate.toISOString(),
          end: now.toISOString()
        }
      };
    }

    return filteredData;
  }

  /**
   * Generate CSV export for analytics data
   * @param {Object} data - Analytics data
   * @param {string} type - Export type ('summary', 'pages', 'referrers', 'timeseries')
   * @returns {string} CSV content
   */
  generateCSVExport(data, type = 'summary') {
    if (!data) {
      throw new Error('No data available for export');
    }

    switch (type) {
      case 'summary':
        return this.generateSummaryCSV(data);
      case 'pages':
        return this.generatePagesCSV(data.top_pages);
      case 'referrers':
        return this.generateReferrersCSV(data.referrers);
      case 'timeseries':
        return this.generateTimeSeriesCSV(data.time_series);
      default:
        throw new Error('Unknown export type: ' + type);
    }
  }

  /**
   * Generate summary CSV
   * @param {Object} data - Analytics data
   * @returns {string} CSV content
   */
  generateSummaryCSV(data) {
    const summary = data.summary || {};
    const metadata = data.metadata || {};
    
    const rows = [
      ['Metric', 'Value'],
      ['Site', metadata.site || 'Unknown'],
      ['Generated At', metadata.generated_at || 'Unknown'],
      ['Total Pageviews', summary.total_pageviews || 0],
      ['Unique Visitors', summary.unique_visitors || 0],
      ['Top Page', summary.top_pages && summary.top_pages[0] ? summary.top_pages[0].path : 'N/A'],
      ['Top Referrer', summary.top_referrer || 'N/A'],
      ['Date Range', summary.date_range || 'all']
    ];

    return this.arrayToCSV(rows);
  }

  /**
   * Generate pages CSV
   * @param {Array} pages - Top pages data
   * @returns {string} CSV content
   */
  generatePagesCSV(pages) {
    if (!pages || !Array.isArray(pages)) {
      return 'Path,Pageviews,Unique Visitors,Percentage\n';
    }

    const rows = [
      ['Path', 'Pageviews', 'Unique Visitors', 'Percentage']
    ];

    pages.forEach(page => {
      rows.push([
        page.path || '',
        page.pageviews || 0,
        page.unique_visitors || 0,
        (page.percentage || 0).toFixed(2) + '%'
      ]);
    });

    return this.arrayToCSV(rows);
  }

  /**
   * Generate referrers CSV
   * @param {Object} referrers - Referrers data
   * @returns {string} CSV content
   */
  generateReferrersCSV(referrers) {
    if (!referrers || !referrers.by_domain || !Array.isArray(referrers.by_domain)) {
      return 'Domain,Visits,Unique Visitors,Percentage\n';
    }

    const rows = [
      ['Domain', 'Visits', 'Unique Visitors', 'Percentage']
    ];

    referrers.by_domain.forEach(referrer => {
      rows.push([
        referrer.domain || '',
        referrer.visits || 0,
        referrer.unique_visitors || 0,
        (referrer.percentage || 0).toFixed(2) + '%'
      ]);
    });

    return this.arrayToCSV(rows);
  }

  /**
   * Generate time series CSV
   * @param {Object} timeSeries - Time series data
   * @returns {string} CSV content
   */
  generateTimeSeriesCSV(timeSeries) {
    if (!timeSeries || !timeSeries.daily || !Array.isArray(timeSeries.daily)) {
      return 'Date,Pageviews,Unique Visitors\n';
    }

    const rows = [
      ['Date', 'Pageviews', 'Unique Visitors']
    ];

    timeSeries.daily.forEach(entry => {
      rows.push([
        entry.date || '',
        entry.pageviews || 0,
        entry.unique_visitors || 0
      ]);
    });

    return this.arrayToCSV(rows);
  }

  /**
   * Convert array to CSV format
   * @param {Array} rows - Array of rows
   * @returns {string} CSV content
   */
  arrayToCSV(rows) {
    return rows.map(row => 
      row.map(cell => {
        // Escape quotes and wrap in quotes if necessary
        const cellStr = String(cell);
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return '"' + cellStr.replace(/"/g, '""') + '"';
        }
        return cellStr;
      }).join(',')
    ).join('\n');
  }

  /**
   * Escape HTML special characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    if (typeof text !== 'string') return '';
    
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

module.exports = { StaticDashboard };