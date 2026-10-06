/**
 * @fileoverview Server Dashboard for Metrona Analytics System
 * Provides Express server with authentication, rate limiting, and API endpoints
 * Validates Requirements 5.4, 8.2, 8.5, 10.5
 */

const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { StaticDashboard } = require('./static-dashboard');
const { DEFAULTS } = require('@analytics-system/shared');

class ServerDashboard {
  constructor(options = {}) {
    this.port = options.port || DEFAULTS.DASHBOARD_PORT;
    /** Listen address. Loopback by default: put a reverse proxy in front for remote access. */
    this.host = options.host || '127.0.0.1';
    /** Origins allowed to embed the dashboard in an iframe (CSP frame-ancestors); empty = nobody. */
    this.frameAncestors = options.frameAncestors || [];
    this.dataDir = options.dataDir || DEFAULTS.DATA_PATH;
    this.passwordHash = options.passwordHash;
    this.httpsOnly = options.httpsOnly !== false; // Default to true for production
    this.rateLimit = options.rateLimit || DEFAULTS.DASHBOARD_RATE_LIMIT;
    this.rateLimitWindow = options.rateLimitWindow || 60 * 1000; // Default 1 minute
    this.sessionSecret = options.sessionSecret || this.generateSessionSecret();
    this.sites = options.sites || [];
    
    this.app = express();
    this.server = null;
    this.staticDashboard = new StaticDashboard({
      dataDir: this.dataDir,
      sites: this.sites
    });
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Generate a secure session secret
   * @returns {string} Random session secret
   */
  generateSessionSecret() {
    const crypto = require('crypto');
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Trust proxy for rate limiting behind reverse proxy
    this.app.set('trust proxy', 1);

    // Parse JSON bodies
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Session configuration
    this.app.use(session({
      secret: this.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: this.httpsOnly, // Require HTTPS in production
        httpOnly: true,
        maxAge: DEFAULTS.SESSION_TIMEOUT,
        sameSite: 'strict'
      },
      name: 'analytics-session' // Don't use default session name
    }));

    // Rate limiting for authentication endpoints
    const authLimiter = rateLimit({
      windowMs: this.rateLimitWindow, // Configurable window
      max: this.rateLimit, // requests per window
      message: {
        error: 'Too many authentication attempts, please try again later',
        retryAfter: Math.ceil(this.rateLimitWindow / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      // Custom key generator to ensure consistent IP detection in tests
      keyGenerator: (req) => {
        return req.headers['x-forwarded-for'] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
               '127.0.0.1';
      }
      // No skip function - apply to all requests that reach this middleware
    });

    this.app.use('/auth', authLimiter);

    // General rate limiting for API endpoints
    const apiLimiter = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: this.rateLimit * 10, // More generous for API calls
      message: {
        error: 'Too many requests, please try again later',
        retryAfter: 60
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => !req.path.startsWith('/api')
    });

    this.app.use('/api', apiLimiter);

    // Security headers
    this.app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (this.frameAncestors.length) {
        res.setHeader('Content-Security-Policy', `frame-ancestors ${this.frameAncestors.join(' ')}`);
      } else {
        res.setHeader('X-Frame-Options', 'DENY');
      }
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      
      if (this.httpsOnly) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      
      next();
    });

    // HTTPS enforcement middleware
    if (this.httpsOnly) {
      this.app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https' && !req.secure) {
          return res.status(400).json({
            error: 'HTTPS required',
            message: 'This dashboard requires HTTPS connections for security'
          });
        }
        next();
      });
    }
  }

  /**
   * Setup Express routes
   */
  setupRoutes() {
    // Authentication routes
    this.app.post('/auth/login', this.handleLogin.bind(this));
    this.app.post('/auth/logout', this.handleLogout.bind(this));
    this.app.get('/auth/status', this.handleAuthStatus.bind(this));

    // Protected API routes
    this.app.use('/api', this.requireAuth.bind(this));
    this.app.get('/api/sites', this.handleGetSites.bind(this));
    this.app.get('/api/data/:siteId', this.handleGetSiteData.bind(this));
    this.app.get('/api/export/:siteId/:type', this.handleExportData.bind(this));

    // Static file serving for dashboard assets
    this.app.use('/static', express.static(path.join(__dirname, '../public')));

    // Dashboard HTML routes (protected)
    this.app.get('/', this.requireAuth.bind(this), this.handleDashboardIndex.bind(this));
    this.app.get('/site/:siteId', this.requireAuth.bind(this), this.handleSitePage.bind(this));

    // Login page (unprotected)
    this.app.get('/login', this.handleLoginPage.bind(this));

    // Health check endpoint (unprotected)
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      console.error('Server error:', err);
      res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
      });
    });
  }

  /**
   * Authentication middleware
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Function} next - Next middleware
   */
  requireAuth(req, res, next) {
    if (!this.passwordHash) {
      // No authentication configured, allow access
      return next();
    }

    if (req.session && req.session.authenticated) {
      return next();
    }

    // For API requests, return JSON error
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        error: 'Authentication required',
        loginUrl: '/login'
      });
    }

    // For HTML requests, redirect to login
    res.redirect('/login');
  }

  /**
   * Handle login requests
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  async handleLogin(req, res) {
    try {
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({ 
          error: 'Password required',
          field: 'password'
        });
      }

      if (!this.passwordHash) {
        return res.status(500).json({ 
          error: 'Authentication not configured'
        });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, this.passwordHash);
      
      if (!isValid) {
        // Add delay to prevent timing attacks
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return res.status(401).json({ 
          error: 'Invalid password'
        });
      }

      // Set session
      req.session.authenticated = true;
      req.session.loginTime = new Date().toISOString();

      res.json({ 
        success: true,
        message: 'Login successful',
        redirectUrl: '/'
      });

    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ 
        error: 'Login failed',
        message: 'An error occurred during authentication'
      });
    }
  }

  /**
   * Handle logout requests
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  handleLogout(req, res) {
    req.session.destroy((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: 'Logout failed' });
      }

      res.clearCookie('analytics-session');
      res.json({ 
        success: true,
        message: 'Logout successful',
        redirectUrl: '/login'
      });
    });
  }

  /**
   * Handle authentication status requests
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  handleAuthStatus(req, res) {
    const isAuthenticated = !this.passwordHash || (req.session && req.session.authenticated);
    
    res.json({
      authenticated: isAuthenticated,
      authRequired: !!this.passwordHash,
      loginTime: req.session?.loginTime || null
    });
  }

  /**
   * Handle sites list API requests
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  async handleGetSites(req, res) {
    try {
      const siteData = await this.staticDashboard.loadAllSiteData();
      
      const sites = Object.entries(siteData).map(([siteId, site]) => ({
        siteId,
        domain: site.config.domain,
        enabled: site.config.enabled !== false,
        hasData: !!site.data,
        lastUpdated: site.lastUpdated,
        error: site.error || null,
        summary: site.data?.summary ? {
          totalPageviews: site.data.summary.total_pageviews || 0,
          uniqueVisitors: site.data.summary.unique_visitors || 0,
          topPage: site.data.summary.top_pages?.[0]?.path || null
        } : null
      }));

      res.json({ sites });

    } catch (error) {
      console.error('Error loading sites:', error);
      res.status(500).json({ 
        error: 'Failed to load sites',
        message: error.message
      });
    }
  }

  /**
   * Handle site data API requests
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  async handleGetSiteData(req, res) {
    try {
      const { siteId } = req.params;
      const { range = 'all' } = req.query;

      if (!siteId) {
        return res.status(400).json({ error: 'Site ID required' });
      }

      // Load raw data
      const data = await this.staticDashboard.loadSiteData(siteId);
      
      // Apply date range filtering
      const filteredData = this.staticDashboard.filterDataByDateRange(data, range);

      res.json({
        siteId,
        range,
        data: filteredData,
        metadata: {
          generated_at: data.metadata?.generated_at,
          site: data.metadata?.site || siteId,
          filtered: range !== 'all'
        }
      });

    } catch (error) {
      console.error('Error loading site data:', error);
      
      if (error.message.includes('not found')) {
        res.status(404).json({ 
          error: 'Site not found',
          siteId: req.params.siteId
        });
      } else {
        res.status(500).json({ 
          error: 'Failed to load site data',
          message: error.message
        });
      }
    }
  }

  /**
   * Handle data export API requests
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  async handleExportData(req, res) {
    try {
      const { siteId, type } = req.params;
      const { range = 'all' } = req.query;

      if (!siteId || !type) {
        return res.status(400).json({ error: 'Site ID and export type required' });
      }

      const validTypes = ['summary', 'pages', 'referrers', 'timeseries'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ 
          error: 'Invalid export type',
          validTypes
        });
      }

      // Load and filter data
      const data = await this.staticDashboard.loadSiteData(siteId);
      const filteredData = this.staticDashboard.filterDataByDateRange(data, range);

      // Generate CSV
      const csv = this.staticDashboard.generateCSVExport(filteredData, type);

      // Set response headers for file download
      const filename = `${siteId}-${type}-${range}-${new Date().toISOString().split('T')[0]}.csv`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache');
      
      res.send(csv);

    } catch (error) {
      console.error('Error exporting data:', error);
      
      if (error.message.includes('not found')) {
        res.status(404).json({ 
          error: 'Site not found',
          siteId: req.params.siteId
        });
      } else {
        res.status(500).json({ 
          error: 'Export failed',
          message: error.message
        });
      }
    }
  }

  /**
   * Handle dashboard index page
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  async handleDashboardIndex(req, res) {
    try {
      const siteData = await this.staticDashboard.loadAllSiteData();
      const html = this.generateServerIndexHTML(siteData);
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);

    } catch (error) {
      console.error('Error rendering dashboard:', error);
      res.status(500).send('Dashboard error: ' + error.message);
    }
  }

  /**
   * Handle individual site page
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  async handleSitePage(req, res) {
    try {
      const { siteId } = req.params;
      
      const siteConfig = this.sites.find(s => s.siteId === siteId);
      if (!siteConfig) {
        return res.status(404).send('Site not found');
      }

      const data = await this.staticDashboard.loadSiteData(siteId);
      const site = { config: siteConfig, data, lastUpdated: data.metadata?.generated_at };
      
      const html = this.generateServerSiteHTML(siteId, site);
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);

    } catch (error) {
      console.error('Error rendering site page:', error);
      res.status(500).send('Site page error: ' + error.message);
    }
  }

  /**
   * Handle login page
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  handleLoginPage(req, res) {
    // If no authentication required, redirect to dashboard
    if (!this.passwordHash) {
      return res.redirect('/');
    }

    // If already authenticated, redirect to dashboard
    if (req.session && req.session.authenticated) {
      return res.redirect('/');
    }

    const html = this.generateLoginHTML();
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  /**
   * Generate server-based index HTML (similar to static but with API calls)
   * @param {Object} siteData - All site data
   * @returns {string} HTML content
   */
  generateServerIndexHTML(siteData) {
    const sites = Object.entries(siteData);
    const totalSites = sites.length;
    const activeSites = sites.filter(([_, site]) => site.data).length;
    
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
    <link rel="stylesheet" href="/static/styles.css">
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="header-controls">
                <h1>📊 Metrona Analytics Dashboard</h1>
                <div class="auth-controls">
                    <button onclick="logout()" class="logout-btn">Logout</button>
                </div>
            </div>
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
                ${sites.map(([siteId, site]) => this.staticDashboard.generateSiteCard(siteId, site)).join('')}
            </div>
        </div>

        <footer class="footer">
            <p>Generated at ${new Date().toLocaleString()}</p>
            <p>Metrona Analytics System - Privacy-focused analytics</p>
        </footer>
    </div>

    <script src="/static/server-dashboard.js"></script>
</body>
</html>`;
  }

  /**
   * Generate server-based site HTML (similar to static but with API calls)
   * @param {string} siteId - Site identifier
   * @param {Object} site - Site data and config
   * @returns {string} HTML content
   */
  generateServerSiteHTML(siteId, site) {
    const data = site.data;
    const summary = data.summary || {};
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${site.config.domain || siteId} - Analytics</title>
    <link rel="stylesheet" href="/static/styles.css">
</head>
<body>
    <div class="container">
        <header class="header">
            <nav class="breadcrumb">
                <a href="/">← Dashboard</a>
            </nav>
            <div class="header-controls">
                <h1>📈 ${site.config.domain || siteId}</h1>
                <div class="auth-controls">
                    <button onclick="logout()" class="logout-btn">Logout</button>
                </div>
            </div>
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
            ${this.staticDashboard.generateTopPagesSection(data.top_pages)}
            ${this.staticDashboard.generateReferrersSection(data.referrers)}
            ${this.staticDashboard.generateTimeSeriesSection(data.time_series)}
        </div>

        <footer class="footer">
            <p>Last updated: ${new Date(site.lastUpdated).toLocaleString()}</p>
            <p>Data generated at: ${data.metadata?.generated_at ? new Date(data.metadata.generated_at).toLocaleString() : 'Unknown'}</p>
        </footer>
    </div>

    <script>
        // Embed site ID for API calls
        window.siteId = '${siteId}';
        window.isServerMode = true;
    </script>
    <script src="/static/server-dashboard.js"></script>
</body>
</html>`;
  }

  /**
   * Generate login page HTML
   * @returns {string} HTML content
   */
  generateLoginHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Metrona Analytics</title>
    <link rel="stylesheet" href="/static/styles.css">
    <style>
        .login-container {
            max-width: 400px;
            margin: 100px auto;
            padding: 40px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            border: 1px solid #e2e8f0;
        }
        
        .login-header {
            text-align: center;
            margin-bottom: 30px;
        }
        
        .login-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .form-group label {
            font-weight: 600;
            color: #4a5568;
        }
        
        .form-group input {
            padding: 12px;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            font-size: 16px;
        }
        
        .form-group input:focus {
            outline: none;
            border-color: #4299e1;
            box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.1);
        }
        
        .login-btn {
            padding: 12px 24px;
            background: #4299e1;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 0.2s ease;
        }
        
        .login-btn:hover {
            background: #3182ce;
        }
        
        .login-btn:disabled {
            background: #a0aec0;
            cursor: not-allowed;
        }
        
        .error-message {
            color: #e53e3e;
            font-size: 14px;
            margin-top: 10px;
            text-align: center;
        }
        
        .security-notice {
            font-size: 12px;
            color: #718096;
            text-align: center;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-header">
            <h1>📊 Metrona Analytics</h1>
            <p>Please enter your password to access the dashboard</p>
        </div>
        
        <form class="login-form" onsubmit="handleLogin(event)">
            <div class="form-group">
                <label for="password">Password</label>
                <input 
                    type="password" 
                    id="password" 
                    name="password" 
                    required 
                    autocomplete="current-password"
                    placeholder="Enter dashboard password"
                >
            </div>
            
            <button type="submit" class="login-btn" id="loginBtn">
                Login
            </button>
            
            <div id="errorMessage" class="error-message" style="display: none;"></div>
        </form>
        
        <div class="security-notice">
            🔒 This dashboard uses secure authentication and HTTPS encryption to protect your analytics data.
        </div>
    </div>

    <script>
        async function handleLogin(event) {
            event.preventDefault();
            
            const form = event.target;
            const password = form.password.value;
            const loginBtn = document.getElementById('loginBtn');
            const errorMessage = document.getElementById('errorMessage');
            
            // Reset error state
            errorMessage.style.display = 'none';
            loginBtn.disabled = true;
            loginBtn.textContent = 'Logging in...';
            
            try {
                const response = await fetch('/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ password })
                });
                
                const result = await response.json();
                
                if (response.ok && result.success) {
                    window.location.href = result.redirectUrl || '/';
                } else {
                    throw new Error(result.error || 'Login failed');
                }
                
            } catch (error) {
                console.error('Login error:', error);
                errorMessage.textContent = error.message || 'Login failed. Please try again.';
                errorMessage.style.display = 'block';
                
                // Clear password field
                form.password.value = '';
                form.password.focus();
                
            } finally {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Login';
            }
        }
        
        // Focus password field on load
        document.addEventListener('DOMContentLoaded', function() {
            document.getElementById('password').focus();
        });
    </script>
</body>
</html>`;
  }

  /**
   * Start the server
   * @returns {Promise<void>}
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, this.host, () => {
          console.log(`🚀 Dashboard server running on ${this.host}:${this.port}`);
          console.log(`📊 Dashboard URL: http${this.httpsOnly ? 's' : ''}://localhost:${this.port}`);
          
          if (this.passwordHash) {
            console.log('🔒 Authentication enabled');
          } else {
            console.log('⚠️  Authentication disabled - dashboard is publicly accessible');
          }
          
          resolve();
        });

        this.server.on('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            reject(new Error(`Port ${this.port} is already in use`));
          } else {
            reject(error);
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the server
   * @returns {Promise<void>}
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('📊 Dashboard server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server status
   * @returns {Object} Server status information
   */
  getStatus() {
    return {
      running: !!this.server && this.server.listening,
      port: this.port,
      httpsOnly: this.httpsOnly,
      authEnabled: !!this.passwordHash,
      rateLimit: this.rateLimit,
      sitesCount: this.sites.length
    };
  }
}

module.exports = { ServerDashboard };