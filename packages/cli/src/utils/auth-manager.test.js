/**
 * @fileoverview Unit tests for AuthManager
 */

const { AuthManager } = require('./auth-manager');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('AuthManager', () => {
  let authManager;
  let tempDir;

  beforeEach(async () => {
    authManager = new AuthManager();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Password Validation', () => {
    test('should accept valid strong password', () => {
      expect(() => {
        authManager.validatePassword('StrongPass947!');
      }).not.toThrow();
    });

    test('should reject password that is too short', () => {
      expect(() => {
        authManager.validatePassword('Short1!');
      }).toThrow('Password must be at least 8 characters long');
    });

    test('should reject password that is too long', () => {
      const longPassword = 'a'.repeat(129) + 'A1!';
      expect(() => {
        authManager.validatePassword(longPassword);
      }).toThrow('Password must be no more than 128 characters long');
    });

    test('should reject password with insufficient complexity', () => {
      expect(() => {
        authManager.validatePassword('onlylowercase');
      }).toThrow('Password must contain at least 3 of');
    });

    test('should reject password with repeated characters', () => {
      expect(() => {
        authManager.validatePassword('Passsss947!');
      }).toThrow('Password cannot contain repeated characters');
    });

    test('should reject password with common patterns', () => {
      expect(() => {
        authManager.validatePassword('Password123!');
      }).toThrow('Password cannot contain common patterns or words');
    });

    test('should reject non-string password', () => {
      expect(() => {
        authManager.validatePassword(123);
      }).toThrow('Password must be a string');
    });
  });

  describe('Password Hashing', () => {
    test('should hash password successfully', async () => {
      const password = 'TestPass947!';
      const hash = await authManager.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^\$2[aby]\$\d+\$/); // bcrypt format
    });

    test('should generate different hashes for same password', async () => {
      const password = 'TestPass947!';
      const hash1 = await authManager.hashPassword(password);
      const hash2 = await authManager.hashPassword(password);
      
      expect(hash1).not.toBe(hash2);
    });

    test('should verify password against hash', async () => {
      const password = 'TestPass947!';
      const hash = await authManager.hashPassword(password);
      
      const isValid = await authManager.verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    test('should reject incorrect password', async () => {
      const password = 'TestPass947!';
      const wrongPassword = 'WrongPass947!';
      const hash = await authManager.hashPassword(password);
      
      const isValid = await authManager.verifyPassword(wrongPassword, hash);
      expect(isValid).toBe(false);
    });
  });

  describe('Authentication Configuration', () => {
    test('should generate auth config with defaults', async () => {
      const password = 'TestPass947!';
      const config = await authManager.generateAuthConfig(password);
      
      expect(config).toMatchObject({
        enabled: true,
        session_timeout: 3600,
        max_login_attempts: 5,
        lockout_duration: 900,
        require_https: true,
        secure_cookies: true,
        csrf_protection: true
      });
      expect(config.password_hash).toBeDefined();
      expect(config.created_at).toBeDefined();
    });

    test('should generate auth config with custom options', async () => {
      const password = 'TestPass947!';
      const options = {
        sessionTimeout: 7200,
        maxLoginAttempts: 3,
        lockoutDuration: 1800,
        requireHttps: false
      };
      
      const config = await authManager.generateAuthConfig(password, options);
      
      expect(config).toMatchObject({
        enabled: true,
        session_timeout: 7200,
        max_login_attempts: 3,
        lockout_duration: 1800,
        require_https: false,
        secure_cookies: true,
        csrf_protection: true
      });
    });

    test('should save and load auth config', async () => {
      const password = 'TestPass947!';
      const config = await authManager.generateAuthConfig(password);
      const configPath = path.join(tempDir, 'auth.json');
      
      await authManager.saveAuthConfig(config, configPath);
      
      // Check file exists and has correct permissions
      const stats = await fs.stat(configPath);
      expect(stats.mode & 0o777).toBe(0o600);
      
      // Load and verify config
      const loadedConfig = await authManager.loadAuthConfig(configPath);
      expect(loadedConfig).toEqual(config);
    });

    test('should throw error when loading non-existent config', async () => {
      const configPath = path.join(tempDir, 'nonexistent.json');
      
      await expect(authManager.loadAuthConfig(configPath))
        .rejects.toThrow('Authentication configuration not found');
    });
  });

  describe('Password Updates', () => {
    test('should update password successfully', async () => {
      const oldPassword = 'OldPass947!';
      const newPassword = 'NewPass456@';
      const configPath = path.join(tempDir, 'auth.json');
      
      // Create initial config
      const config = await authManager.generateAuthConfig(oldPassword);
      await authManager.saveAuthConfig(config, configPath);
      
      // Update password
      await authManager.updatePassword(configPath, newPassword, oldPassword);
      
      // Verify new password works
      const updatedConfig = await authManager.loadAuthConfig(configPath);
      const isValid = await authManager.verifyPassword(newPassword, updatedConfig.password_hash);
      expect(isValid).toBe(true);
      
      // Verify old password no longer works
      const isOldValid = await authManager.verifyPassword(oldPassword, updatedConfig.password_hash);
      expect(isOldValid).toBe(false);
    });

    test('should reject password update with wrong current password', async () => {
      const oldPassword = 'OldPass947!';
      const newPassword = 'NewPass456@';
      const wrongPassword = 'WrongPass789#';
      const configPath = path.join(tempDir, 'auth.json');
      
      // Create initial config
      const config = await authManager.generateAuthConfig(oldPassword);
      await authManager.saveAuthConfig(config, configPath);
      
      // Try to update with wrong current password
      await expect(authManager.updatePassword(configPath, newPassword, wrongPassword))
        .rejects.toThrow('Current password is incorrect');
    });
  });

  describe('Secure Password Generation', () => {
    test('should generate password with default length', () => {
      const password = authManager.generateSecurePassword();
      
      expect(password).toBeDefined();
      expect(password.length).toBe(16);
      expect(() => authManager.validatePassword(password)).not.toThrow();
    });

    test('should generate password with custom length', () => {
      const password = authManager.generateSecurePassword(24);
      
      expect(password.length).toBe(24);
      expect(() => authManager.validatePassword(password)).not.toThrow();
    });

    test('should generate different passwords each time', () => {
      const password1 = authManager.generateSecurePassword();
      const password2 = authManager.generateSecurePassword();
      
      expect(password1).not.toBe(password2);
    });
  });

  describe('Authentication Status', () => {
    test('should return configured status for existing config', async () => {
      const password = 'TestPass947!';
      const config = await authManager.generateAuthConfig(password);
      const configPath = path.join(tempDir, 'auth.json');
      
      await authManager.saveAuthConfig(config, configPath);
      
      const status = await authManager.checkAuthStatus(configPath);
      
      expect(status).toMatchObject({
        configured: true,
        enabled: true,
        requiresHttps: true,
        sessionTimeout: 3600,
        maxLoginAttempts: 5
      });
    });

    test('should return not configured status for missing config', async () => {
      const configPath = path.join(tempDir, 'nonexistent.json');
      
      const status = await authManager.checkAuthStatus(configPath);
      
      expect(status).toMatchObject({
        configured: false
      });
      expect(status.error).toBeDefined();
    });
  });
});