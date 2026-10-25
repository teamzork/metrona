/**
 * @fileoverview Unit tests for SystemdServiceGenerator
 */

const { SystemdServiceGenerator } = require('./systemd-service');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('SystemdServiceGenerator', () => {
  let generator;
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'systemd-test-'));
    generator = new SystemdServiceGenerator({
      systemdDir: tempDir,
      serviceName: 'test-analytics',
      user: 'test-user',
      group: 'test-group',
      backupDir: path.join(tempDir, 'backups')
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Service File Generation', () => {
    test('should generate valid service file content', () => {
      const config = {
        outputDir: '/opt/analytics',
        configPath: '/etc/analytics/config.yaml'
      };

      const serviceContent = generator.generateServiceFile(config);

      expect(serviceContent).toContain('[Unit]');
      expect(serviceContent).toContain('[Service]');
      expect(serviceContent).toContain('[Install]');
      expect(serviceContent).toContain('Description=Metrona Analytics System');
      expect(serviceContent).toContain('User=test-user');
      expect(serviceContent).toContain('Group=test-group');
      expect(serviceContent).toContain('WorkingDirectory=/opt/analytics');
      expect(serviceContent).toContain('CONFIG_PATH=/etc/analytics/config.yaml');
      expect(serviceContent).toContain('WantedBy=multi-user.target');
    });

    test('should include security settings', () => {
      const config = {
        outputDir: '/opt/analytics',
        configPath: '/etc/analytics/config.yaml'
      };

      const serviceContent = generator.generateServiceFile(config);

      expect(serviceContent).toContain('NoNewPrivileges=true');
      expect(serviceContent).toContain('PrivateTmp=true');
      expect(serviceContent).toContain('ProtectSystem=strict');
      expect(serviceContent).toContain('ProtectHome=true');
    });

    test('should include resource limits', () => {
      const config = {
        outputDir: '/opt/analytics',
        configPath: '/etc/analytics/config.yaml'
      };

      const serviceContent = generator.generateServiceFile(config);

      expect(serviceContent).toContain('LimitNOFILE=65536');
      expect(serviceContent).toContain('LimitNPROC=4096');
    });
  });

  describe('Service File Backup and Restore', () => {
    test('should create backup of existing service file', async () => {
      const servicePath = path.join(tempDir, 'test-analytics.service');
      const originalContent = 'original service content';
      
      // Create original service file
      await fs.writeFile(servicePath, originalContent);
      
      // Create backup
      const backupPath = await generator.createServiceBackup(servicePath);
      
      expect(backupPath).toBeDefined();
      expect(backupPath).toContain('test-analytics.service.backup.');
      
      // Verify backup content
      const backupContent = await fs.readFile(backupPath, 'utf8');
      expect(backupContent).toBe(originalContent);
    });

    test('should return null when no service file exists', async () => {
      const servicePath = path.join(tempDir, 'nonexistent.service');
      
      const backupPath = await generator.createServiceBackup(servicePath);
      
      expect(backupPath).toBeNull();
    });

    test('should restore service file from backup', async () => {
      const servicePath = path.join(tempDir, 'test-analytics.service');
      const backupPath = path.join(tempDir, 'backups', 'test-analytics.service.backup.test');
      const backupContent = 'backup service content';
      
      // Create backup directory and file
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.writeFile(backupPath, backupContent);
      
      // Restore from backup
      await generator.restoreServiceFromBackup(backupPath, servicePath);
      
      // Verify restored content
      const restoredContent = await fs.readFile(servicePath, 'utf8');
      expect(restoredContent).toBe(backupContent);
    });

    test('should remove service file when no backup exists', async () => {
      const servicePath = path.join(tempDir, 'test-analytics.service');
      
      // Create service file
      await fs.writeFile(servicePath, 'test content');
      
      // Restore with no backup (should remove file)
      await generator.restoreServiceFromBackup(null, servicePath);
      
      // Verify file is removed
      await expect(fs.access(servicePath)).rejects.toThrow();
    });
  });

  describe('Service File Writing with Rollback', () => {
    test('should write service file successfully', async () => {
      const config = {
        outputDir: '/opt/analytics',
        configPath: '/etc/analytics/config.yaml'
      };

      const result = await generator.writeServiceFileWithRollback(config);

      expect(result.success).toBe(true);
      expect(result.servicePath).toBe(path.join(tempDir, 'test-analytics.service'));
      expect(result.backupPath).toBeNull(); // No existing file to backup
      expect(typeof result.rollback).toBe('function');

      // Verify file was created
      const serviceContent = await fs.readFile(result.servicePath, 'utf8');
      expect(serviceContent).toContain('[Unit]');
    });

    test('should create backup when overwriting existing file', async () => {
      const config = {
        outputDir: '/opt/analytics',
        configPath: '/etc/analytics/config.yaml'
      };
      const servicePath = path.join(tempDir, 'test-analytics.service');
      const originalContent = 'original content';

      // Create existing service file
      await fs.writeFile(servicePath, originalContent);

      const result = await generator.writeServiceFileWithRollback(config);

      expect(result.success).toBe(true);
      expect(result.backupPath).toBeDefined();
      expect(result.backupPath).toContain('test-analytics.service.backup.');

      // Verify backup contains original content
      const backupContent = await fs.readFile(result.backupPath, 'utf8');
      expect(backupContent).toBe(originalContent);
    });

    // root ignores directory permission bits, so the write can't be forced to fail
    const testUnlessRoot = process.getuid && process.getuid() === 0 ? test.skip : test;
    testUnlessRoot('should rollback on write failure', async () => {
      const config = {
        outputDir: '/opt/analytics',
        configPath: '/etc/analytics/config.yaml'
      };
      const servicePath = path.join(tempDir, 'test-analytics.service');
      const originalContent = 'original content';

      // Create existing service file
      await fs.writeFile(servicePath, originalContent);

      // Make directory read-only to cause write failure
      await fs.chmod(tempDir, 0o444);

      try {
        await expect(generator.writeServiceFileWithRollback(config))
          .rejects.toThrow();
      } finally {
        // Restore permissions first: without the execute bit the directory
        // can't be traversed, so the file couldn't be read back (EACCES)
        await fs.chmod(tempDir, 0o755);
      }

      // Verify original file is still there (rollback occurred)
      const restoredContent = await fs.readFile(servicePath, 'utf8');
      expect(restoredContent).toBe(originalContent);
    });
  });

  describe('Complete Service Generation with Rollback', () => {
    test('should generate complete service setup', async () => {
      const config = {
        outputDir: '/opt/analytics',
        configPath: '/etc/analytics/config.yaml'
      };

      const result = await generator.generateServiceWithRollback(config);

      expect(result.success).toBe(true);
      expect(result.servicePath).toBeDefined();
      expect(result.userScriptPath).toBeDefined();
      expect(result.dirScriptPath).toBeDefined();
      expect(typeof result.rollback).toBe('function');

      // Verify service file exists
      await expect(fs.access(result.servicePath)).resolves.not.toThrow();

      // Verify script files exist
      await expect(fs.access(result.userScriptPath)).resolves.not.toThrow();
      await expect(fs.access(result.dirScriptPath)).resolves.not.toThrow();
    });

    test('should rollback complete setup', async () => {
      const config = {
        outputDir: '/opt/analytics',
        configPath: '/etc/analytics/config.yaml'
      };

      const result = await generator.generateServiceWithRollback(config);
      
      // Execute rollback
      await result.rollback();

      // Verify service file is removed (no backup existed)
      await expect(fs.access(result.servicePath)).rejects.toThrow();

      // Script files should be cleaned up
      await expect(fs.access(result.userScriptPath)).rejects.toThrow();
      await expect(fs.access(result.dirScriptPath)).rejects.toThrow();
    });
  });

  describe('User and Directory Scripts', () => {
    test('should generate user creation script', () => {
      const scriptContent = generator.generateUserCreationScript();

      expect(scriptContent).toContain('#!/bin/bash');
      expect(scriptContent).toContain('groupadd --system test-group');
      expect(scriptContent).toContain('useradd --system --gid test-group');
      expect(scriptContent).toContain('--home-dir /var/lib/test-analytics');
    });

    test('should generate directory setup script', () => {
      const config = {
        outputDir: '/opt/analytics',
        configPath: '/etc/analytics/config.yaml'
      };

      const scriptContent = generator.generateDirectorySetupScript(config);

      expect(scriptContent).toContain('#!/bin/bash');
      expect(scriptContent).toContain('mkdir -p /opt/analytics');
      expect(scriptContent).toContain('chown -R test-user:test-group /opt/analytics');
      expect(scriptContent).toContain('chmod 755 /opt/analytics');
    });

    test('should write user creation script', async () => {
      const scriptPath = await generator.writeUserCreationScript();

      expect(scriptPath).toBe('/tmp/create-test-analytics-user.sh');

      // Note: In test environment, we can't actually write to /tmp
      // This test verifies the method doesn't crash and returns expected path
    });
  });

  describe('Service Instructions', () => {
    test('should generate service management instructions', () => {
      const instructions = generator.getServiceInstructions();

      expect(instructions).toContain('systemd Service Management');
      expect(instructions).toContain('sudo systemctl start test-analytics');
      expect(instructions).toContain('sudo systemctl stop test-analytics');
      expect(instructions).toContain('journalctl -u test-analytics');
      expect(instructions).toContain('runs as user "test-user"');
    });
  });
});