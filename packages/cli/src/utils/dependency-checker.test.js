/**
 * @fileoverview Simple unit tests for DependencyChecker
 * Using new pragmatic testing strategy - basic functionality only
 */

const { DependencyChecker } = require('./dependency-checker');

describe('DependencyChecker', () => {
  let checker;

  beforeEach(() => {
    checker = new DependencyChecker();
  });

  describe('Constructor', () => {
    it('should initialize with default dependencies', () => {
      expect(checker.dependencies).toHaveLength(3);
      expect(checker.dependencies[0].name).toBe('Node.js');
      expect(checker.dependencies[1].name).toBe('nginx');
      expect(checker.dependencies[2].name).toBe('systemd');
    });
  });

  describe('validateNodeVersion', () => {
    it('should validate compatible Node.js version', async () => {
      const result = await checker.validateNodeVersion('v18.17.0');
      
      expect(result.valid).toBe(true);
      expect(result.version).toBe('18.17.0');
      expect(result.message).toContain('compatible');
    });

    it('should reject old Node.js version', async () => {
      const result = await checker.validateNodeVersion('v16.20.0');
      
      expect(result.valid).toBe(false);
      expect(result.version).toBe('16.20.0');
      expect(result.message).toContain('version 18+ is required');
    });

    it('should handle invalid version format', async () => {
      const result = await checker.validateNodeVersion('invalid version');
      
      expect(result.valid).toBe(false);
      expect(result.version).toBeNull();
      expect(result.message).toContain('Could not determine');
    });
  });

  describe('validateNginxVersion', () => {
    it('should validate nginx version', async () => {
      // Mock fs.access to succeed
      const fs = require('fs').promises;
      jest.spyOn(fs, 'access').mockResolvedValue();

      const result = await checker.validateNginxVersion('nginx version: nginx/1.18.0');
      
      expect(result.valid).toBe(true);
      expect(result.version).toBe('1.18.0');
      expect(result.message).toContain('compatible');

      fs.access.mockRestore();
    });

    it('should handle missing nginx config directory', async () => {
      // Mock fs.access to fail
      const fs = require('fs').promises;
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

      const result = await checker.validateNginxVersion('nginx version: nginx/1.18.0');
      
      expect(result.valid).toBe(false);
      expect(result.version).toBe('1.18.0');
      expect(result.message).toContain('not accessible');

      fs.access.mockRestore();
    });
  });

  describe('validateSystemdVersion', () => {
    it('should validate compatible systemd version', async () => {
      const result = await checker.validateSystemdVersion('systemd 245 (245.4-4ubuntu3.22)');
      
      expect(result.valid).toBe(true);
      expect(result.version).toBe('245');
      expect(result.message).toContain('compatible');
    });

    it('should reject old systemd version', async () => {
      const result = await checker.validateSystemdVersion('systemd 219');
      
      expect(result.valid).toBe(false);
      expect(result.version).toBe('219');
      expect(result.message).toContain('version 220+ is recommended');
    });
  });

  describe('checkPlatform', () => {
    it('should check platform compatibility', () => {
      const originalPlatform = process.platform;
      
      // Mock Linux platform
      Object.defineProperty(process, 'platform', { value: 'linux' });
      
      const result = checker.checkPlatform();
      
      expect(result.platform).toBe('linux');
      expect(result.supported).toBe(true);
      expect(result.message).toContain('supported');
      
      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('isRunningAsRoot', () => {
    it('should check if running as root', () => {
      // This test depends on the actual environment
      // Just verify the method exists and returns a boolean
      const result = checker.isRunningAsRoot();
      expect(typeof result).toBe('boolean');
    });
  });
});