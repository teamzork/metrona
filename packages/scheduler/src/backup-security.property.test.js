/**
 * @fileoverview Property-based tests for backup creation reliability and file security permissions
 * Feature: metrona-analytics-system, Property 12: Backup Creation Reliability, Property 30: File Security Permissions
 * Validates: Requirements 3.4, 8.3
 */

const fc = require('fast-check');
const fs = require('fs').promises;
const path = require('path');
const { BackupManager } = require('./backup-manager');
const { ConfigurationManager } = require('./config-manager');

// Mock fs module for property tests
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

// Reset fs mocks before every fast-check iteration (not just every test):
// call counts and one-off implementations otherwise leak between iterations.
// Listing the backup dir (done by createBackup's cleanup step) sees no files.
const freshMocks = () => {
  jest.resetAllMocks();
  fs.readdir.mockResolvedValue([]);
};

describe('Property 12: Backup Creation Reliability', () => {
  let backupManager;

  beforeEach(() => {
    jest.clearAllMocks();
    
    backupManager = new BackupManager({
      backupDir: '/test/backups',
      maxBackups: 10,
      filePermissions: 0o600
    });
  });

  /**
   * Property: Backup creation should always succeed for valid file content
   * For any valid file content, backup creation should complete successfully and create all required files
   */
  it('should reliably create backups for any valid file content', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        filePath: fc.constantFrom(
          '/etc/analytics/config.yaml',
          '/home/user/analytics.yaml', 
          '/var/config/site.yaml',
          '/tmp/test-config.yaml'
        ),
        content: fc.oneof(
          // Valid YAML content
          fc.constant('version: "1.0"\nsites: []'),
          fc.constant('version: "1.0"\nsites:\n  - siteId: test\n    domain: example.com'),
          // JSON content (also valid for backup)
          fc.constant('{"version": "1.0", "sites": []}'),
          // Plain text content
          fc.stringOf(fc.char(), { minLength: 0, maxLength: 1000 }),
          // Empty content
          fc.constant('')
        ),
        label: fc.option(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 1, maxLength: 20 }))
      }),
      async ({ filePath, content, label }) => {
        // Mock successful file operations
        fs.access.mockResolvedValue();
        fs.mkdir.mockResolvedValue();
        fs.readFile.mockResolvedValue(content);
        fs.writeFile.mockResolvedValue();
        fs.chmod.mockResolvedValue();

        // Create backup
        const backupPath = await backupManager.createBackup(filePath, {
          label: label || undefined,
          metadata: { testProperty: true }
        });

        // Verify backup path is generated
        expect(backupPath).toBeDefined();
        expect(typeof backupPath).toBe('string');
        expect(backupPath).toMatch(/backup/);

        // Verify backup directory creation
        expect(fs.mkdir).toHaveBeenCalledWith('/test/backups', { recursive: true });

        // Verify source file was read
        expect(fs.readFile).toHaveBeenCalledWith(filePath, 'utf8');

        // Verify backup file was written with correct content
        const backupWriteCall = fs.writeFile.mock.calls.find(call => 
          call[0] === backupPath && call[1] === content
        );
        expect(backupWriteCall).toBeDefined();

        // Verify metadata file was written
        const metadataWriteCall = fs.writeFile.mock.calls.find(call => 
          call[0].endsWith('.meta')
        );
        expect(metadataWriteCall).toBeDefined();

        // Verify secure permissions were set
        expect(fs.chmod).toHaveBeenCalledWith(backupPath, 0o600);
        expect(fs.chmod).toHaveBeenCalledWith(expect.stringMatching(/\.meta$/), 0o600);
      }
    ).beforeEach(freshMocks), { numRuns: 100 });
  });

  /**
   * Property: Backup metadata should always contain required fields
   * For any backup creation, metadata should include all essential information
   */
  it('should create complete metadata for all backups', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        filePath: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.startsWith('/')),
        content: fc.stringOf(fc.char(), { minLength: 0, maxLength: 500 }),
        label: fc.option(fc.string({ minLength: 1, maxLength: 20 })),
        customMetadata: fc.record({
          operation: fc.constantFrom('config-update', 'site-add', 'site-remove'),
          userId: fc.option(fc.string({ minLength: 1, maxLength: 20 }))
        })
      }),
      async ({ filePath, content, label, customMetadata }) => {
        // Mock file operations
        fs.access.mockResolvedValue();
        fs.mkdir.mockResolvedValue();
        fs.readFile.mockResolvedValue(content);
        fs.writeFile.mockResolvedValue();
        fs.chmod.mockResolvedValue();

        await backupManager.createBackup(filePath, {
          label,
          metadata: customMetadata
        });

        // Find metadata write call
        const metadataCall = fs.writeFile.mock.calls.find(call => 
          call[0].endsWith('.meta')
        );
        
        expect(metadataCall).toBeDefined();
        
        const metadataContent = JSON.parse(metadataCall[1]);
        
        // Verify required metadata fields
        expect(metadataContent.originalPath).toBe(filePath);
        expect(metadataContent.backupPath).toBeDefined();
        expect(metadataContent.timestamp).toBeDefined();
        expect(metadataContent.fileSize).toBe(content.length);
        expect(metadataContent.checksum).toBeDefined();
        expect(metadataContent.label).toBe(label || null);
        
        // Verify custom metadata is preserved
        expect(metadataContent.operation).toBe(customMetadata.operation);
        if (customMetadata.userId) {
          expect(metadataContent.userId).toBe(customMetadata.userId);
        }
      }
    ).beforeEach(freshMocks), { numRuns: 50 });
  });

  /**
   * Property: Backup checksums should be consistent and verifiable
   * For any file content, the checksum should be deterministic and verifiable
   */
  it('should generate consistent and verifiable checksums', async () => {
    await fc.assert(fc.asyncProperty(
      fc.stringOf(fc.char(), { minLength: 0, maxLength: 1000 }),
      async (content) => {
        const filePath = '/test/file.yaml';
        
        fs.access.mockResolvedValue();
        fs.mkdir.mockResolvedValue();
        fs.readFile.mockResolvedValue(content);
        fs.writeFile.mockResolvedValue();
        fs.chmod.mockResolvedValue();

        // Create backup twice
        await backupManager.createBackup(filePath);
        await backupManager.createBackup(filePath);

        // Get both metadata calls
        const metadataCalls = fs.writeFile.mock.calls.filter(call => 
          call[0].endsWith('.meta')
        );
        
        expect(metadataCalls.length).toBe(2);
        
        const metadata1 = JSON.parse(metadataCalls[0][1]);
        const metadata2 = JSON.parse(metadataCalls[1][1]);
        
        // Checksums should be identical for same content
        expect(metadata1.checksum).toBe(metadata2.checksum);
        
        // Verify checksum is correct
        const crypto = require('crypto');
        const expectedChecksum = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
        expect(metadata1.checksum).toBe(expectedChecksum);
      }
    ).beforeEach(freshMocks), { numRuns: 50 });
  });

  /**
   * Property: Backup restoration should preserve file content exactly
   * For any backed up content, restoration should produce identical content
   */
  it('should preserve content exactly through backup and restore cycle', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        originalContent: fc.stringOf(fc.char(), { minLength: 0, maxLength: 500 }),
        filePath: fc.constantFrom('/test/config.yaml', '/etc/analytics.yaml')
      }),
      async ({ originalContent, filePath }) => {
        const backupPath = '/test/backups/backup-123.yaml';
        const checksum = require('crypto').createHash('sha256').update(originalContent, 'utf8').digest('hex');
        
        const metadata = {
          originalPath: filePath,
          backupPath: backupPath,
          checksum: checksum
        };

        // Mock backup creation
        fs.access.mockResolvedValue();
        fs.mkdir.mockResolvedValue();
        fs.readFile
          .mockResolvedValueOnce(originalContent) // backup creation
          .mockResolvedValueOnce(JSON.stringify(metadata)) // restore metadata
          .mockResolvedValueOnce(originalContent); // restore content
        fs.writeFile.mockResolvedValue();
        fs.chmod.mockResolvedValue();

        // Create backup
        await backupManager.createBackup(filePath);

        // Restore from backup
        const restoredPath = await backupManager.restoreFromBackup(backupPath, filePath);

        // Verify restoration
        expect(restoredPath).toBe(filePath);
        
        // Find the restore write call
        const restoreCall = fs.writeFile.mock.calls.find(call => 
          call[0] === filePath && call[1] === originalContent
        );
        expect(restoreCall).toBeDefined();
      }
    ).beforeEach(freshMocks), { numRuns: 50 });
  });

  /**
   * Property: Backup operations should handle concurrent access safely
   * For any sequence of backup operations, each should complete independently
   */
  it('should handle multiple backup operations safely', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(
        fc.record({
          filePath: fc.constantFrom('/test/config1.yaml', '/test/config2.yaml', '/test/config3.yaml'),
          content: fc.stringOf(fc.char(), { minLength: 0, maxLength: 200 }),
          label: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 10 })
        }),
        { minLength: 1, maxLength: 5 }
      ),
      async (backupOperations) => {
        // Mock file operations for all operations
        fs.access.mockResolvedValue();
        fs.mkdir.mockResolvedValue();
        fs.writeFile.mockResolvedValue();
        fs.chmod.mockResolvedValue();
        
        // Set up readFile to return appropriate content for each file
        backupOperations.forEach(op => {
          fs.readFile.mockResolvedValueOnce(op.content);
        });

        // Execute all backup operations
        const backupPaths = [];
        for (const operation of backupOperations) {
          const backupPath = await backupManager.createBackup(operation.filePath, {
            label: operation.label
          });
          backupPaths.push(backupPath);
        }

        // Verify all backups were created
        expect(backupPaths.length).toBe(backupOperations.length);
        
        // Verify each backup path is unique
        const uniquePaths = new Set(backupPaths);
        expect(uniquePaths.size).toBe(backupPaths.length);

        // Verify correct number of file operations
        expect(fs.writeFile).toHaveBeenCalledTimes(backupOperations.length * 2); // backup + metadata files
        expect(fs.chmod).toHaveBeenCalledTimes(backupOperations.length * 2); // backup + metadata permissions
      }
    ).beforeEach(freshMocks), { numRuns: 30 });
  });
});

describe('Property 30: File Security Permissions', () => {
  let backupManager;
  let configManager;

  beforeEach(() => {
    jest.clearAllMocks();
    
    backupManager = new BackupManager({
      backupDir: '/test/backups',
      filePermissions: 0o600
    });
    
    configManager = new ConfigurationManager({
      configPath: '/test/config.yaml',
      createBackups: true
    });
  });

  /**
   * Property: All sensitive files should have secure permissions (0o600)
   * For any sensitive file created by the system, permissions should be 0o600 or more restrictive
   */
  it('should set secure permissions on all sensitive files', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        fileType: fc.constantFrom('config', 'backup', 'metadata'),
        content: fc.stringOf(fc.char(), { minLength: 0, maxLength: 500 }),
        filePath: fc.constantFrom(
          '/etc/analytics/config.yaml',
          '/var/analytics/backup.yaml',
          '/home/user/.analytics/config.yaml'
        )
      }),
      async ({ fileType, content, filePath }) => {
        fs.access.mockResolvedValue();
        fs.mkdir.mockResolvedValue();
        fs.readFile.mockResolvedValue(content);
        fs.writeFile.mockResolvedValue();
        fs.chmod.mockResolvedValue();

        if (fileType === 'config') {
          // Test configuration file permissions
          const config = { version: '1.0', sites: [] };
          await configManager.saveConfiguration(config);
          
          // Verify config file has secure permissions
          expect(fs.chmod).toHaveBeenCalledWith(expect.any(String), 0o600);
          
        } else if (fileType === 'backup') {
          // Test backup file permissions
          await backupManager.createBackup(filePath);
          
          // Verify backup file has secure permissions
          const chmodCalls = fs.chmod.mock.calls;
          const backupPermissionCall = chmodCalls.find(call => 
            !call[0].endsWith('.meta') && call[1] === 0o600
          );
          expect(backupPermissionCall).toBeDefined();
          
        } else if (fileType === 'metadata') {
          // Test metadata file permissions
          await backupManager.createBackup(filePath);
          
          // Verify metadata file has secure permissions
          const chmodCalls = fs.chmod.mock.calls;
          const metadataPermissionCall = chmodCalls.find(call => 
            call[0].endsWith('.meta') && call[1] === 0o600
          );
          expect(metadataPermissionCall).toBeDefined();
        }
      }
    ).beforeEach(freshMocks), { numRuns: 50 });
  });

  /**
   * Property: Permission verification should correctly identify secure and insecure files
   * For any file permission mode, verification should accurately determine security level
   */
  it('should correctly verify file permission security', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        // Generate various permission modes
        ownerPerms: fc.constantFrom(0o000, 0o200, 0o400, 0o600, 0o700), // Owner permissions
        groupPerms: fc.constantFrom(0o000, 0o020, 0o040, 0o060, 0o070), // Group permissions  
        otherPerms: fc.constantFrom(0o000, 0o002, 0o004, 0o006, 0o007)  // Other permissions
      }),
      async ({ ownerPerms, groupPerms, otherPerms }) => {
        const mode = 0o100000 | ownerPerms | groupPerms | otherPerms; // Regular file + permissions
        const filePath = '/test/file.yaml';
        
        fs.stat.mockResolvedValue({ mode });

        const isSecure = await backupManager.verifySecurePermissions(filePath);

        // File is secure if:
        // 1. No group or other permissions (groupPerms === 0 && otherPerms === 0)
        // 2. Owner has at least write permission (ownerPerms & 0o200)
        const expectedSecure = (groupPerms === 0o000 && otherPerms === 0o000 && (ownerPerms & 0o200) !== 0);
        
        expect(isSecure).toBe(expectedSecure);
      }
    ).beforeEach(freshMocks), { numRuns: 100 });
  });

  /**
   * Property: Secure permission setting should be idempotent
   * For any file, setting secure permissions multiple times should be safe and consistent
   */
  it('should safely set secure permissions multiple times', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        filePath: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.startsWith('/')),
        iterations: fc.integer({ min: 1, max: 5 })
      }),
      async ({ filePath, iterations }) => {
        fs.chmod.mockResolvedValue();

        // Set secure permissions multiple times
        for (let i = 0; i < iterations; i++) {
          await backupManager.setSecurePermissions(filePath);
        }

        // Verify chmod was called the correct number of times with correct permissions
        expect(fs.chmod).toHaveBeenCalledTimes(iterations);
        
        for (let i = 0; i < iterations; i++) {
          expect(fs.chmod).toHaveBeenNthCalledWith(i + 1, filePath, 0o600);
        }
      }
    ).beforeEach(freshMocks), { numRuns: 30 });
  });

  /**
   * Property: Configuration security verification should detect all permission issues
   * For any configuration setup, security verification should accurately report the security status
   */
  it('should accurately verify configuration security status', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        configFileMode: fc.constantFrom(0o100600, 0o100644, 0o100755, 0o100400), // Various config file permissions
        backupDirMode: fc.constantFrom(0o040700, 0o040755, 0o040750, 0o040000),  // Various directory permissions
        configExists: fc.boolean(),
        backupDirExists: fc.boolean()
      }),
      async ({ configFileMode, backupDirMode, configExists, backupDirExists }) => {
        // Mock file system state
        if (configExists) {
          fs.stat.mockResolvedValueOnce({ mode: configFileMode });
        } else {
          const error = new Error('File not found');
          error.code = 'ENOENT';
          fs.stat.mockRejectedValueOnce(error);
        }
        
        if (backupDirExists) {
          fs.access.mockResolvedValueOnce(); // backup dir exists
          fs.stat.mockResolvedValueOnce({ mode: backupDirMode });
        } else {
          const error = new Error('Directory not found');
          error.code = 'ENOENT';
          fs.access.mockRejectedValueOnce(error);
        }

        const security = await configManager.verifyConfigurationSecurity();

        if (configExists) {
          // Check if config file permissions are secure (0o600)
          const configSecure = (configFileMode & parseInt('077', 8)) === 0 && 
                              (configFileMode & parseInt('200', 8)) !== 0;
          expect(security.configurationFile.secure).toBe(configSecure);
          expect(security.configurationFile.exists).toBe(true);
        } else {
          expect(security.configurationFile.exists).toBe(false);
        }

        if (backupDirExists) {
          // Check if backup directory permissions are secure (no group/other access)
          const backupDirSecure = (backupDirMode & parseInt('077', 8)) === 0;
          expect(security.backupDirectory.secure).toBe(backupDirSecure);
        }
      }
    ).beforeEach(freshMocks), { numRuns: 50 });
  });

  /**
   * Property: Backup directory creation should have secure permissions
   * For any backup directory creation, the directory should be created with secure permissions
   */
  it('should create backup directories with secure permissions', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        backupDir: fc.constantFrom(
          '/var/analytics/backups',
          '/home/user/.analytics/backups',
          '/etc/analytics/backups',
          '/tmp/analytics-backups'
        ),
        content: fc.stringOf(fc.char(), { minLength: 0, maxLength: 100 })
      }),
      async ({ backupDir, content }) => {
        const customBackupManager = new BackupManager({
          backupDir: backupDir,
          filePermissions: 0o600
        });
        
        const filePath = '/test/config.yaml';
        
        fs.access.mockResolvedValue();
        fs.mkdir.mockResolvedValue();
        fs.readFile.mockResolvedValue(content);
        fs.writeFile.mockResolvedValue();
        fs.chmod.mockResolvedValue();

        await customBackupManager.createBackup(filePath);

        // Verify backup directory was created with recursive option
        expect(fs.mkdir).toHaveBeenCalledWith(backupDir, { recursive: true });
        
        // Verify files in backup directory have secure permissions
        expect(fs.chmod).toHaveBeenCalledWith(expect.stringMatching(new RegExp(backupDir)), 0o600);
      }
    ).beforeEach(freshMocks), { numRuns: 30 });
  });

  /**
   * Property: Permission inheritance should be consistent across all backup operations
   * For any backup manager configuration, all created files should inherit the same secure permissions
   */
  it('should consistently apply permissions across all backup operations', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        customPermissions: fc.constantFrom(0o600, 0o400, 0o200), // Various secure permission levels
        operations: fc.array(
          fc.record({
            filePath: fc.constantFrom('/test/config1.yaml', '/test/config2.yaml'),
            content: fc.stringOf(fc.char(), { minLength: 0, maxLength: 100 })
          }),
          { minLength: 1, maxLength: 3 }
        )
      }),
      async ({ customPermissions, operations }) => {
        const customBackupManager = new BackupManager({
          backupDir: '/test/backups',
          filePermissions: customPermissions
        });
        
        fs.access.mockResolvedValue();
        fs.mkdir.mockResolvedValue();
        fs.writeFile.mockResolvedValue();
        fs.chmod.mockResolvedValue();
        
        // Set up readFile mocks for each operation
        operations.forEach(op => {
          fs.readFile.mockResolvedValueOnce(op.content);
        });

        // Perform all backup operations
        for (const operation of operations) {
          await customBackupManager.createBackup(operation.filePath);
        }

        // Verify all chmod calls used the custom permissions
        const chmodCalls = fs.chmod.mock.calls;
        expect(chmodCalls.length).toBe(operations.length * 2); // backup + metadata files
        
        for (const call of chmodCalls) {
          expect(call[1]).toBe(customPermissions);
        }
      }
    ).beforeEach(freshMocks), { numRuns: 30 });
  });
});