/**
 * @fileoverview Unit tests for backup and rollback functionality
 * Feature: metrona-analytics-system, Requirements 3.4, 8.3
 */

const fs = require('fs').promises;
const path = require('path');
const { BackupManager } = require('./backup-manager');
const { ConfigurationManager } = require('./config-manager');

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    chmod: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn(),
    unlink: jest.fn()
  }
}));

describe('BackupManager', () => {
  let backupManager;
  let mockBackupDir;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockBackupDir = '/test/backups';
    backupManager = new BackupManager({
      backupDir: mockBackupDir,
      maxBackups: 5,
      filePermissions: 0o600
    });
  });

  describe('createBackup', () => {
    it('should create backup with metadata', async () => {
      const sourceFile = '/test/config.yaml';
      const sourceContent = 'version: "1.0"\nsites: []';
      
      fs.access.mockResolvedValue();
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue(sourceContent);
      fs.writeFile.mockResolvedValue();
      fs.chmod.mockResolvedValue();

      const backupPath = await backupManager.createBackup(sourceFile, {
        label: 'test-backup',
        metadata: { operation: 'test' }
      });

      expect(fs.mkdir).toHaveBeenCalledWith(mockBackupDir, { recursive: true });
      expect(fs.readFile).toHaveBeenCalledWith(sourceFile, 'utf8');
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/config\.yaml-backup-.*-test-backup$/),
        sourceContent,
        'utf8'
      );
      expect(fs.chmod).toHaveBeenCalledWith(expect.any(String), 0o600);
      expect(backupPath).toMatch(/config\.yaml-backup-.*-test-backup$/);
    });

    it('should throw error when source file does not exist', async () => {
      const sourceFile = '/test/nonexistent.yaml';
      const error = new Error('File not found');
      error.code = 'ENOENT';
      
      fs.access.mockRejectedValue(error);
      fs.mkdir.mockResolvedValue();

      await expect(backupManager.createBackup(sourceFile)).rejects.toThrow(
        'Source file does not exist: /test/nonexistent.yaml'
      );
    });

    it('should create metadata file with correct information', async () => {
      const sourceFile = '/test/config.yaml';
      const sourceContent = 'test content';
      
      fs.access.mockResolvedValue();
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue(sourceContent);
      fs.writeFile.mockResolvedValue();
      fs.chmod.mockResolvedValue();

      await backupManager.createBackup(sourceFile, {
        label: 'test',
        metadata: { custom: 'data' }
      });

      // Check that metadata file was written
      const metadataCall = fs.writeFile.mock.calls.find(call => 
        call[0].endsWith('.meta')
      );
      
      expect(metadataCall).toBeDefined();
      
      const metadataContent = JSON.parse(metadataCall[1]);
      expect(metadataContent).toMatchObject({
        originalPath: sourceFile,
        label: 'test',
        fileSize: sourceContent.length,
        custom: 'data'
      });
      expect(metadataContent.checksum).toBeDefined();
      expect(metadataContent.timestamp).toBeDefined();
    });
  });

  describe('restoreFromBackup', () => {
    it('should restore file from backup with verification', async () => {
      const backupPath = '/test/backups/config-backup-123.yaml';
      const targetPath = '/test/config.yaml';
      const backupContent = 'restored content';
      const metadata = {
        originalPath: targetPath,
        checksum: require('crypto').createHash('sha256').update(backupContent, 'utf8').digest('hex')
      };

      fs.access.mockResolvedValue();
      fs.readFile
        .mockResolvedValueOnce(JSON.stringify(metadata)) // metadata file
        .mockResolvedValueOnce(backupContent); // backup file
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.chmod.mockResolvedValue();

      const restoredPath = await backupManager.restoreFromBackup(backupPath);

      expect(fs.readFile).toHaveBeenCalledWith(`${backupPath}.meta`, 'utf8');
      expect(fs.readFile).toHaveBeenCalledWith(backupPath, 'utf8');
      expect(fs.writeFile).toHaveBeenCalledWith(targetPath, backupContent, 'utf8');
      expect(fs.chmod).toHaveBeenCalledWith(targetPath, 0o600);
      expect(restoredPath).toBe(targetPath);
    });

    it('should create pre-restore backup by default', async () => {
      const backupPath = '/test/backups/config-backup-123.yaml';
      const targetPath = '/test/config.yaml';
      const backupContent = 'restored content';
      const currentContent = 'current content';
      const metadata = {
        originalPath: targetPath,
        checksum: require('crypto').createHash('sha256').update(backupContent, 'utf8').digest('hex')
      };

      fs.access.mockResolvedValue();
      fs.readFile
        .mockResolvedValueOnce(JSON.stringify(metadata)) // metadata file
        .mockResolvedValueOnce(backupContent) // backup file
        .mockResolvedValueOnce(currentContent); // current file for pre-restore backup
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.chmod.mockResolvedValue();

      await backupManager.restoreFromBackup(backupPath);

      // Should have created pre-restore backup
      const preRestoreBackupCall = fs.writeFile.mock.calls.find(call =>
        call[0].includes('pre-restore')
      );
      expect(preRestoreBackupCall).toBeDefined();
    });

    it('should throw error on checksum mismatch', async () => {
      const backupPath = '/test/backups/config-backup-123.yaml';
      const backupContent = 'corrupted content';
      const metadata = {
        originalPath: '/test/config.yaml',
        checksum: 'wrong-checksum'
      };

      fs.access.mockResolvedValue();
      fs.readFile
        .mockResolvedValueOnce(JSON.stringify(metadata))
        .mockResolvedValueOnce(backupContent);

      await expect(backupManager.restoreFromBackup(backupPath)).rejects.toThrow(
        'Backup file integrity check failed - checksum mismatch'
      );
    });
  });

  describe('listBackups', () => {
    it('should list backups sorted by timestamp', async () => {
      const mockFiles = [
        'config-backup-1.yaml.meta',
        'config-backup-2.yaml.meta',
        'other-file.txt'
      ];
      
      const metadata1 = {
        originalPath: '/test/config.yaml',
        backupPath: '/test/backups/config-backup-1.yaml',
        timestamp: '2026-01-01T10:00:00Z'
      };
      
      const metadata2 = {
        originalPath: '/test/config.yaml',
        backupPath: '/test/backups/config-backup-2.yaml',
        timestamp: '2026-01-01T12:00:00Z'
      };

      fs.access.mockResolvedValue();
      fs.readdir.mockResolvedValue(mockFiles);
      fs.readFile
        .mockResolvedValueOnce(JSON.stringify(metadata1))
        .mockResolvedValueOnce(JSON.stringify(metadata2));

      const backups = await backupManager.listBackups('/test/config.yaml');

      expect(backups).toHaveLength(2);
      expect(backups[0].timestamp).toBe('2026-01-01T12:00:00Z'); // Newer first
      expect(backups[1].timestamp).toBe('2026-01-01T10:00:00Z');
    });

    it('should filter backups by file path', async () => {
      const mockFiles = [
        'config-backup-1.yaml.meta',
        'other-backup-1.yaml.meta'
      ];
      
      const configMetadata = {
        originalPath: '/test/config.yaml',
        backupPath: '/test/backups/config-backup-1.yaml',
        timestamp: '2026-01-01T10:00:00Z'
      };
      
      const otherMetadata = {
        originalPath: '/test/other.yaml',
        backupPath: '/test/backups/other-backup-1.yaml',
        timestamp: '2026-01-01T11:00:00Z'
      };

      fs.access.mockResolvedValue();
      fs.readdir.mockResolvedValue(mockFiles);
      fs.readFile
        .mockResolvedValueOnce(JSON.stringify(configMetadata))
        .mockResolvedValueOnce(JSON.stringify(otherMetadata));

      const backups = await backupManager.listBackups('/test/config.yaml');

      expect(backups).toHaveLength(1);
      expect(backups[0].originalPath).toBe('/test/config.yaml');
    });
  });

  describe('verifySecurePermissions', () => {
    it('should return true for secure permissions (0o600)', async () => {
      const mockStats = {
        mode: 0o100600 // Regular file with 0o600 permissions
      };
      
      fs.stat.mockResolvedValue(mockStats);

      const result = await backupManager.verifySecurePermissions('/test/file');

      expect(result).toBe(true);
    });

    it('should return false for insecure permissions', async () => {
      const mockStats = {
        mode: 0o100644 // Regular file with 0o644 permissions (group/other readable)
      };
      
      fs.stat.mockResolvedValue(mockStats);

      const result = await backupManager.verifySecurePermissions('/test/file');

      expect(result).toBe(false);
    });
  });
});

describe('ConfigurationManager with Backup Integration', () => {
  let configManager;
  let mockConfigPath;
  let files;

  // Back fs.readFile/writeFile with an in-memory table keyed by path
  const mockFiles = (initial) => {
    files = { ...initial };
    fs.readFile.mockImplementation(async (p) => {
      if (!(p in files)) {
        const error = new Error(`ENOENT: no such file, open '${p}'`);
        error.code = 'ENOENT';
        throw error;
      }
      return files[p];
    });
    fs.writeFile.mockImplementation(async (p, content) => {
      files[p] = content;
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfigPath = '/test/config.yaml';
    configManager = new ConfigurationManager({
      configPath: mockConfigPath,
      backupDir: '/test/backups',
      createBackups: true
    });
  });

  describe('saveConfiguration with backup', () => {
    it('should create backup before saving', async () => {
      const config = {
        version: '1.0',
        sites: [{
          siteId: 'test-site',
          siteName: 'Test Site',
          domain: 'example.com',
          logPath: '/var/log/test.log',
          schedule: 'daily',
          enabled: true
        }]
      };

      fs.access.mockResolvedValue(); // Config file exists
      fs.readFile.mockResolvedValue('existing config');
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.chmod.mockResolvedValue();

      const backupPath = await configManager.saveConfiguration(config, {
        operationLabel: 'test-operation'
      });

      expect(backupPath).toBeDefined();
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/backup.*test-operation/),
        'existing config',
        'utf8'
      );
    });

    it('should set secure permissions on config file', async () => {
      const config = {
        version: '1.0',
        sites: []
      };

      const error = new Error('File not found');
      error.code = 'ENOENT';
      fs.access.mockRejectedValue(error); // No existing file
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.chmod.mockResolvedValue();

      await configManager.saveConfiguration(config);

      expect(fs.chmod).toHaveBeenCalledWith(mockConfigPath, 0o600);
    });
  });

  describe('rollbackConfiguration', () => {
    it('should rollback to most recent backup', async () => {
      const backupContent = 'version: "1.0"\nsites: []';
      const backupMetadata = {
        originalPath: mockConfigPath,
        backupPath: '/test/backups/config-backup-123.yaml',
        timestamp: '2026-01-01T12:00:00Z',
        checksum: require('crypto').createHash('sha256').update(backupContent, 'utf8').digest('hex')
      };

      // Mock listBackups to return available backups
      fs.access.mockResolvedValue();
      fs.readdir.mockImplementation(async () =>
        Object.keys(files).filter(f => f.endsWith('.meta')).map(f => path.basename(f))
      );
      // Serve reads by path from an in-memory file table that writes update.
      // (A call-order queue breaks because createBackup also lists backups
      // during its cleanup step, consuming extra reads.)
      mockFiles({
        [`${backupMetadata.backupPath}.meta`]: JSON.stringify(backupMetadata),
        [backupMetadata.backupPath]: backupContent,
        [mockConfigPath]: 'current config'
      });
      fs.mkdir.mockResolvedValue();
      fs.chmod.mockResolvedValue();

      const restoredConfig = await configManager.rollbackConfiguration();

      expect(restoredConfig).toEqual({ version: '1.0', sites: [] });
      expect(fs.writeFile).toHaveBeenCalledWith(mockConfigPath, backupContent, 'utf8');
    });

    it('should create pre-rollback backup', async () => {
      const backupContent = 'version: "1.0"\nsites: []';
      const backupMetadata = {
        originalPath: mockConfigPath,
        backupPath: '/test/backups/config-backup-123.yaml',
        timestamp: '2026-01-01T12:00:00Z',
        checksum: require('crypto').createHash('sha256').update(backupContent, 'utf8').digest('hex')
      };

      fs.access.mockResolvedValue();
      fs.readdir.mockImplementation(async () =>
        Object.keys(files).filter(f => f.endsWith('.meta')).map(f => path.basename(f))
      );
      // Serve reads by path from an in-memory file table that writes update.
      // (A call-order queue breaks because createBackup also lists backups
      // during its cleanup step, consuming extra reads.)
      mockFiles({
        [`${backupMetadata.backupPath}.meta`]: JSON.stringify(backupMetadata),
        [backupMetadata.backupPath]: backupContent,
        [mockConfigPath]: 'current config'
      });
      fs.mkdir.mockResolvedValue();
      fs.chmod.mockResolvedValue();

      await configManager.rollbackConfiguration();

      // Should have created pre-rollback backup
      const preRollbackCall = fs.writeFile.mock.calls.find(call =>
        call[0].includes('pre-rollback')
      );
      expect(preRollbackCall).toBeDefined();
    });

    it('should throw error when no backups available', async () => {
      fs.access.mockResolvedValue();
      fs.readdir.mockResolvedValue([]);

      await expect(configManager.rollbackConfiguration()).rejects.toThrow(
        'No backups available for rollback'
      );
    });
  });

  describe('verifyConfigurationSecurity', () => {
    it('should verify configuration and backup security', async () => {
      // Mock config file permissions (secure)
      fs.stat
        .mockResolvedValueOnce({ mode: 0o100600 }) // config file
        .mockResolvedValueOnce({ mode: 0o040700 }); // backup directory
      fs.access.mockResolvedValue();

      const security = await configManager.verifyConfigurationSecurity();

      expect(security.configurationFile.secure).toBe(true);
      expect(security.backupDirectory.secure).toBe(true);
    });

    it('should detect insecure permissions', async () => {
      // Mock config file permissions (insecure)
      fs.stat
        .mockResolvedValueOnce({ mode: 0o100644 }) // config file (world readable)
        .mockResolvedValueOnce({ mode: 0o040755 }); // backup directory (world accessible)
      fs.access.mockResolvedValue();

      const security = await configManager.verifyConfigurationSecurity();

      expect(security.configurationFile.secure).toBe(false);
      expect(security.backupDirectory.secure).toBe(false);
    });
  });

  describe('cleanupBackups', () => {
    it('should cleanup old backups beyond retention limit', async () => {
      const oldBackups = Array.from({ length: 8 }, (_, i) => ({
        originalPath: mockConfigPath,
        backupPath: `/test/backups/config-backup-${i}.yaml`,
        // Recent (i days ago) so only the keep limit, not maxAge, applies
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
        fileSize: 100
      }));

      fs.access.mockResolvedValue();
      fs.readdir.mockResolvedValue(oldBackups.map(b => `${path.basename(b.backupPath)}.meta`));
      
      // Mock metadata reads
      oldBackups.forEach(backup => {
        fs.readFile.mockResolvedValueOnce(JSON.stringify(backup));
      });
      
      fs.unlink.mockResolvedValue();

      const result = await configManager.cleanupBackups({
        keepBackups: 3,
        maxAge: 30
      });

      expect(result.backupsDeleted).toBe(5); // 8 - 3 = 5
      expect(result.backupsKept).toBe(3);
    });
  });
});