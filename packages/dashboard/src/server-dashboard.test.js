/**
 * @fileoverview Unit tests for ServerDashboard
 */

const { ServerDashboard } = require('./server-dashboard');
const bcrypt = require('bcryptjs');

describe('ServerDashboard', () => {
  let dashboard;
  const testConfig = {
    port: 3002, // Use different port for testing
    dataDir: './test-data',
    passwordHash: null,
    httpsOnly: false,
    sites: [
      { siteId: 'test-site', domain: 'test.example.com', enabled: true }
    ]
  };

  beforeEach(() => {
    dashboard = new ServerDashboard(testConfig);
  });

  afterEach(async () => {
    if (dashboard.server && dashboard.server.listening) {
      await dashboard.stop();
    }
  });

  describe('Constructor', () => {
    test('should initialize with default values', () => {
      const defaultDashboard = new ServerDashboard();
      
      expect(defaultDashboard.port).toBe(3001);
      expect(defaultDashboard.httpsOnly).toBe(true);
      expect(defaultDashboard.app).toBeDefined();
    });

    test('should initialize with custom options', () => {
      expect(dashboard.port).toBe(3002);
      expect(dashboard.dataDir).toBe('./test-data');
      expect(dashboard.httpsOnly).toBe(false);
      expect(dashboard.sites).toHaveLength(1);
    });

    test('should generate session secret', () => {
      expect(dashboard.sessionSecret).toBeDefined();
      expect(typeof dashboard.sessionSecret).toBe('string');
      expect(dashboard.sessionSecret.length).toBeGreaterThan(0);
    });
  });

  describe('Authentication', () => {
    test('should allow access when no password is configured', () => {
      const req = { session: {}, path: '/api/sites' };
      const res = {};
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      dashboard.requireAuth(req, res, next);
      
      expect(nextCalled).toBe(true);
    });

    test('should require authentication when password is configured', async () => {
      const password = 'test-password';
      dashboard.passwordHash = await bcrypt.hash(password, 12);
      
      const req = { session: {}, path: '/api/sites' };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      dashboard.requireAuth(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        loginUrl: '/login'
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('should allow access when authenticated', async () => {
      const password = 'test-password';
      dashboard.passwordHash = await bcrypt.hash(password, 12);
      
      const req = { 
        session: { authenticated: true }, 
        path: '/api/sites' 
      };
      const res = {};
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      dashboard.requireAuth(req, res, next);
      
      expect(nextCalled).toBe(true);
    });
  });

  describe('Login handling', () => {
    beforeEach(async () => {
      dashboard.passwordHash = await bcrypt.hash('test-password', 12);
    });

    test('should reject login with missing password', async () => {
      const req = { body: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await dashboard.handleLogin(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Password required',
        field: 'password'
      });
    });

    test('should reject login with invalid password', async () => {
      const req = { 
        body: { password: 'wrong-password' },
        session: {}
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await dashboard.handleLogin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid password'
      });
    });

    test('should accept login with valid password', async () => {
      const req = { 
        body: { password: 'test-password' },
        session: {}
      };
      const res = {
        json: jest.fn()
      };

      await dashboard.handleLogin(req, res);

      expect(req.session.authenticated).toBe(true);
      expect(req.session.loginTime).toBeDefined();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Login successful',
        redirectUrl: '/'
      });
    });
  });

  describe('Server lifecycle', () => {
    test('should start server successfully', async () => {
      await expect(dashboard.start()).resolves.toBeUndefined();
      expect(dashboard.server).toBeDefined();
      expect(dashboard.server.listening).toBe(true);
    });

    test('should stop server successfully', async () => {
      await dashboard.start();
      await expect(dashboard.stop()).resolves.toBeUndefined();
      expect(dashboard.server.listening).toBe(false);
    });

    test('should get server status', () => {
      const status = dashboard.getStatus();
      
      expect(status).toEqual({
        running: false,
        port: 3002,
        httpsOnly: false,
        authEnabled: false,
        rateLimit: 10,
        sitesCount: 1
      });
    });
  });

  describe('HTML generation', () => {
    test('should generate login HTML', () => {
      const html = dashboard.generateLoginHTML();
      
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Metrona Analytics');
      expect(html).toContain('type="password"');
      expect(html).toContain('handleLogin');
    });

    test('should generate server index HTML', () => {
      const siteData = {
        'test-site': {
          config: { domain: 'test.example.com' },
          data: {
            summary: {
              total_pageviews: 1000,
              unique_visitors: 500
            }
          },
          lastUpdated: new Date().toISOString()
        }
      };

      const html = dashboard.generateServerIndexHTML(siteData);
      
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Metrona Analytics Dashboard');
      expect(html).toContain('1,000'); // Formatted pageviews
      expect(html).toContain('Logout');
      expect(html).toContain('server-dashboard.js');
      // Site cards link to the server's site route, not the static export's file names.
      expect(html).toContain("window.location.href='/site/test-site'");
      expect(html).not.toContain('test-site.html');
    });

    test('should generate server site HTML', () => {
      const site = {
        config: { domain: 'test.example.com' },
        data: {
          summary: {
            total_pageviews: 1000,
            unique_visitors: 500,
            top_pages: [{ path: '/test', pageviews: 100 }]
          },
          top_pages: [],
          referrers: { by_domain: [] },
          time_series: { daily: [] },
          metadata: { generated_at: new Date().toISOString() }
        },
        lastUpdated: new Date().toISOString()
      };

      const html = dashboard.generateServerSiteHTML('test-site', site);
      
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('test.example.com');
      expect(html).toContain('1,000'); // Formatted pageviews
      expect(html).toContain('window.siteId = \'test-site\'');
      expect(html).toContain('window.isServerMode = true');
    });
  });

  describe('Error handling', () => {
    test('should handle authentication errors gracefully', async () => {
      // Set password hash first
      dashboard.passwordHash = await bcrypt.hash('test-password', 12);
      
      // Simulate bcrypt error
      const originalCompare = bcrypt.compare;
      bcrypt.compare = jest.fn().mockRejectedValue(new Error('Bcrypt error'));

      const req = { 
        body: { password: 'test-password' },
        session: {}
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await dashboard.handleLogin(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Login failed',
        message: 'An error occurred during authentication'
      });

      // Restore original function
      bcrypt.compare = originalCompare;
    });

    test('should handle logout errors gracefully', () => {
      const req = {
        session: {
          destroy: jest.fn((callback) => callback(new Error('Session error')))
        }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      dashboard.handleLogout(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Logout failed'
      });
    });
  });
});