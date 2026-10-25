/**
 * @fileoverview Unit tests for ConfigurationManager
 * Feature: metrona-analytics-system, Requirements 3.1, 3.2, 3.3, 3.5, 3.6
 */

const fs = require('fs').promises;
const path = require('path');
const { ConfigurationManager } = require('./config-manager');

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    stat: jest.fn(),
    // Used by BackupManager (secure permissions, backup listing/cleanup)
    chmod: jest.fn(),
    readdir: jest.fn(),
    unlink: jest.fn()
  }
}));

describe('ConfigurationManager', () => {
  let configManager;
  let mockConfigPath;
  let mockBackupDir;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.chmod.mockResolvedValue();
    fs.readdir.mockResolvedValue([]);
    fs.unlink.mockResolvedValue();
    
    mockConfigPath = '/test/config/analytics.yaml';
    mockBackupDir = '/test/config/backups';
    
    configManager = new ConfigurationManager({
      configPath: mockConfigPath,
      backupDir: mockBackupDir
    });
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const manager = new ConfigurationManager();
      expect(manager.configPath).toBe('./config/analytics.yaml');
      expect(manager.createBackups).toBe(true);
    });

    it('should initialize with custom options', () => {
      const options = {
        configPath: '/custom/path.yaml',
        createBackups: false,
        backupDir: '/custom/backups'
      };
      
      const manager = new ConfigurationManager(options);
      expect(manager.configPath).toBe('/custom/path.yaml');
      expect(manager.createBackups).toBe(false);
      expect(manager.backupDir).toBe('/custom/backups');
    });
  });

  describe('loadConfiguration', () => {
    it('should load and validate configuration successfully', async () => {
      const mockConfig = {
        version: '1.0',
        sites: [
          {
            siteId: 'test-site',
            siteName: 'Test Site',
            domain: 'example.com',
            logPath: '/var/log/nginx/example.log',
            schedule: 'daily',
            enabled: true
          }
        ]
      };

      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      const result = await configManager.loadConfiguration();
      
      expect(fs.access).toHaveBeenCalledWith(mockConfigPath);
      expect(fs.readFile).toHaveBeenCalledWith(mockConfigPath, 'utf8');
      expect(result).toEqual(mockConfig);
    });

    it('should throw error when configuration file not found', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      fs.access.mockRejectedValue(error);

      await expect(configManager.loadConfiguration()).rejects.toThrow(
        `Configuration file not found: ${mockConfigPath}`
      );
    });

    it('should throw error for invalid YAML format', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue('invalid: yaml: content: [');

      await expect(configManager.loadConfiguration()).rejects.toThrow(
        'Invalid YAML format in configuration file'
      );
    });

    it('should throw error for invalid configuration structure', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue('invalid_config: true');

      await expect(configManager.loadConfiguration()).rejects.toThrow(
        'Configuration must have a sites array'
      );
    });
  });

  describe('saveConfiguration', () => {
    const validConfig = {
      version: '1.0',
      sites: [
        {
          siteId: 'test-site',
          siteName: 'Test Site',
          domain: 'example.com',
          logPath: '/var/log/nginx/example.log',
          schedule: 'daily',
          enabled: true
        }
      ]
    };

    it('should save configuration with backup', async () => {
      fs.access.mockResolvedValue(); // Config file exists
      fs.readFile.mockResolvedValue('existing config');
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await configManager.saveConfiguration(validConfig);

      expect(fs.mkdir).toHaveBeenCalledWith(mockBackupDir, { recursive: true });
      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(mockConfigPath), { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        mockConfigPath,
        expect.stringContaining('version: \'1.0\''),
        'utf8'
      );
    });

    it('should save configuration without backup when file does not exist', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      fs.access.mockRejectedValue(error);
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await configManager.saveConfiguration(validConfig);

      expect(fs.writeFile).toHaveBeenCalledWith(
        mockConfigPath,
        expect.stringContaining('version: \'1.0\''),
        'utf8'
      );
    });

    it('should throw error for invalid configuration', async () => {
      const invalidConfig = { invalid: true };

      await expect(configManager.saveConfiguration(invalidConfig)).rejects.toThrow(
        'Configuration must have a sites array'
      );
    });

    it('should throw error when backup creation fails', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockRejectedValue(new Error('Backup failed'));

      await expect(configManager.saveConfiguration(validConfig)).rejects.toThrow(
        'Failed to create backup'
      );
    });

    it('should throw error when file write fails', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      fs.access.mockRejectedValue(error);
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockRejectedValue(new Error('Write failed'));

      await expect(configManager.saveConfiguration(validConfig)).rejects.toThrow(
        'Failed to save configuration: Write failed'
      );
    });
  });

  describe('addSite', () => {
    const validSiteConfig = {
      siteId: 'new-site',
      siteName: 'New Site',
      domain: 'newsite.com',
      logPath: '/var/log/nginx/newsite.log',
      schedule: 'daily'
    };

    it('should add site to existing configuration', async () => {
      const existingConfig = {
        version: '1.0',
        sites: [
          {
            siteId: 'existing-site',
            siteName: 'Existing Site',
            domain: 'existing.com',
            logPath: '/var/log/nginx/existing.log',
            schedule: 'daily',
            enabled: true,
            timezone: 'UTC'
          }
        ]
      };

      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await configManager.addSite(validSiteConfig);

      expect(result.sites).toHaveLength(2);
      expect(result.sites[1]).toMatchObject({
        siteId: 'new-site',
        siteName: 'New Site',
        domain: 'newsite.com',
        logPath: '/var/log/nginx/newsite.log',
        schedule: 'daily',
        enabled: true,
        timezone: 'UTC'
      });
    });

    it('should create default configuration when none exists', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      fs.access.mockRejectedValue(error);
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await configManager.addSite(validSiteConfig);

      expect(result.sites).toHaveLength(1);
      expect(result.sites[0]).toMatchObject({
        siteId: 'new-site',
        siteName: 'New Site',
        domain: 'newsite.com'
      });
    });

    it('should throw error for duplicate site ID', async () => {
      const existingConfig = {
        version: '1.0',
        sites: [
          {
            siteId: 'new-site', // Same ID as new site
            siteName: 'Existing Site',
            domain: 'existing.com',
            logPath: '/var/log/nginx/existing.log',
            schedule: 'daily',
            enabled: true
          }
        ]
      };

      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));

      await expect(configManager.addSite(validSiteConfig)).rejects.toThrow(
        "Site with ID 'new-site' already exists"
      );
    });

    it('should throw error for duplicate domain', async () => {
      const existingConfig = {
        version: '1.0',
        sites: [
          {
            siteId: 'existing-site',
            siteName: 'Existing Site',
            domain: 'newsite.com', // Same domain as new site
            logPath: '/var/log/nginx/existing.log',
            schedule: 'daily',
            enabled: true
          }
        ]
      };

      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));

      await expect(configManager.addSite(validSiteConfig)).rejects.toThrow(
        "Site with domain 'newsite.com' already exists"
      );
    });

    it('should throw error for invalid site configuration', async () => {
      const invalidSiteConfig = {
        siteId: 'invalid-site',
        // Missing required fields
      };

      await expect(configManager.addSite(invalidSiteConfig)).rejects.toThrow(
        'Site must have a valid siteName string'
      );
    });
  });

  describe('removeSite', () => {
    const existingConfig = {
      version: '1.0',
      sites: [
        {
          siteId: 'site1',
          siteName: 'Site 1',
          domain: 'site1.com',
          logPath: '/var/log/nginx/site1.log',
          schedule: 'daily',
          enabled: true
        },
        {
          siteId: 'site2',
          siteName: 'Site 2',
          domain: 'site2.com',
          logPath: '/var/log/nginx/site2.log',
          schedule: 'hourly',
          enabled: true
        }
      ]
    };

    it('should remove site successfully', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await configManager.removeSite('site1');

      expect(result.sites).toHaveLength(1);
      expect(result.sites[0].siteId).toBe('site2');
    });

    it('should throw error when site not found', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));

      await expect(configManager.removeSite('nonexistent')).rejects.toThrow(
        "Site with ID 'nonexistent' not found"
      );
    });

    it('should throw error when no sites configured', async () => {
      const emptyConfig = { version: '1.0', sites: [] };
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(emptyConfig));

      await expect(configManager.removeSite('site1')).rejects.toThrow(
        'No sites configured'
      );
    });
  });

  describe('updateSite', () => {
    const existingConfig = {
      version: '1.0',
      sites: [
        {
          siteId: 'site1',
          siteName: 'Site 1',
          domain: 'site1.com',
          logPath: '/var/log/nginx/site1.log',
          schedule: 'daily',
          enabled: true
        }
      ]
    };

    it('should update site successfully', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const updates = {
        siteName: 'Updated Site 1',
        schedule: 'hourly'
      };

      const result = await configManager.updateSite('site1', updates);

      expect(result.sites[0]).toMatchObject({
        siteId: 'site1',
        siteName: 'Updated Site 1',
        domain: 'site1.com',
        schedule: 'hourly'
      });
    });

    it('should throw error when site not found', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));

      await expect(configManager.updateSite('nonexistent', {})).rejects.toThrow(
        "Site with ID 'nonexistent' not found"
      );
    });

    it('should throw error for invalid updates', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));

      const invalidUpdates = {
        domain: '.invalid-domain'  // Domain starting with dot is invalid
      };

      await expect(configManager.updateSite('site1', invalidUpdates)).rejects.toThrow(
        'Invalid domain format'
      );
    });
  });

  describe('setSiteEnabled', () => {
    const existingConfig = {
      version: '1.0',
      sites: [
        {
          siteId: 'site1',
          siteName: 'Site 1',
          domain: 'site1.com',
          logPath: '/var/log/nginx/site1.log',
          schedule: 'daily',
          enabled: true
        }
      ]
    };

    it('should enable site', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await configManager.setSiteEnabled('site1', true);

      expect(result.sites[0].enabled).toBe(true);
    });

    it('should disable site', async () => {
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await configManager.setSiteEnabled('site1', false);

      expect(result.sites[0].enabled).toBe(false);
    });
  });

  describe('getEnabledSites', () => {
    it('should return only enabled sites', async () => {
      const config = {
        version: '1.0',
        sites: [
          {
            siteId: 'site1',
            siteName: 'Site 1',
            domain: 'site1.com',
            logPath: '/var/log/nginx/site1.log',
            schedule: 'daily',
            enabled: true
          },
          {
            siteId: 'site2',
            siteName: 'Site 2',
            domain: 'site2.com',
            logPath: '/var/log/nginx/site2.log',
            schedule: 'daily',
            enabled: false
          },
          {
            siteId: 'site3',
            siteName: 'Site 3',
            domain: 'site3.com',
            logPath: '/var/log/nginx/site3.log',
            schedule: 'daily'
            // enabled defaults to true
          }
        ]
      };

      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(config));

      const result = await configManager.getEnabledSites();

      expect(result).toHaveLength(2);
      expect(result[0].siteId).toBe('site1');
      expect(result[1].siteId).toBe('site3');
    });

    it('should return empty array when no sites configured', async () => {
      const config = { version: '1.0', sites: [] };
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(config));

      const result = await configManager.getEnabledSites();

      expect(result).toEqual([]);
    });
  });

  describe('validateDomainName', () => {
    it('should validate correct domain names', () => {
      const validDomains = [
        'example.com',
        'subdomain.example.com',
        'test-site.co.uk',
        'a.b.c.d.example.org'
      ];

      validDomains.forEach(domain => {
        expect(configManager.validateDomainName(domain)).toBe(true);
      });
    });

    it('should reject invalid domain names', () => {
      const invalidDomains = [
        '',
        'invalid..domain.com',
        '.example.com',
        'example.com.',
        'ex ample.com',
        'example-.com',
        '-example.com',
        'a'.repeat(64) + '.com', // Label too long
        'a'.repeat(250) + '.com' // Domain too long
      ];

      invalidDomains.forEach(domain => {
        expect(configManager.validateDomainName(domain)).toBe(false);
      });
    });
  });

  describe('validateLogPath', () => {
    it('should validate correct log paths', () => {
      const validPaths = [
        '/var/log/nginx/access.log',
        '/home/user/logs/site.log',
        '/tmp/test.log',
        '/var/log/nginx/' // Directory path
      ];

      validPaths.forEach(logPath => {
        expect(configManager.validateLogPath(logPath)).toBe(true);
      });
    });

    it('should reject invalid log paths', () => {
      const invalidPaths = [
        '',
        'relative/path.log', // Not absolute
        '/var/log/../etc/passwd', // Contains ..
        '/var/log//double-slash.log', // Contains //
        '/var/log/file.txt' // Wrong extension
      ];

      invalidPaths.forEach(logPath => {
        expect(configManager.validateLogPath(logPath)).toBe(false);
      });
    });
  });

  describe('validateSchedule', () => {
    it('should validate predefined schedule formats', () => {
      const validSchedules = [
        'daily',
        'hourly',
        'weekly',
        'monthly',
        'every-minute',
        'every-hour',
        'every-day',
        'every-week',
        'every-month'
      ];

      validSchedules.forEach(schedule => {
        expect(configManager.validateSchedule(schedule)).toBe(true);
      });
    });

    it('should validate cron expressions', () => {
      const validCronExpressions = [
        '0 0 * * *', // Daily at midnight
        '0 */6 * * *', // Every 6 hours
        '30 2 * * 1' // Weekly on Monday at 2:30 AM
      ];

      validCronExpressions.forEach(schedule => {
        expect(configManager.validateSchedule(schedule)).toBe(true);
      });
    });

    it('should reject invalid schedules', () => {
      const invalidSchedules = [
        '',
        'invalid-schedule',
        '* * * *', // Invalid cron (too few fields)
        '60 25 32 13 8' // Invalid cron (out of range values)
      ];

      invalidSchedules.forEach(schedule => {
        expect(configManager.validateSchedule(schedule)).toBe(false);
      });
    });
  });

  describe('createDefaultConfiguration', () => {
    it('should create valid default configuration', () => {
      const defaultConfig = configManager.createDefaultConfiguration();

      expect(defaultConfig).toMatchObject({
        version: '1.0',
        scheduler: {
          timezone: 'UTC',
          outputDir: '/var/analytics/data'
        },
        sites: [],
        jobs: {
          cleanup: {
            schedule: 'daily',
            enabled: true,
            options: {
              maxAge: 7
            }
          },
          healthCheck: {
            schedule: 'hourly',
            enabled: true
          }
        }
      });

      // Validate that default config passes validation
      expect(() => configManager.validateConfiguration(defaultConfig)).not.toThrow();
    });
  });
});