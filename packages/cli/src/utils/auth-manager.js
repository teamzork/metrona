/**
 * @fileoverview Authentication manager for Metrona Analytics System
 * Handles secure password hashing and authentication setup
 */

const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');

class AuthManager {
  constructor(options = {}) {
    this.saltRounds = options.saltRounds || 12; // Appropriate cost factor for bcrypt
    this.minPasswordLength = options.minPasswordLength || 8;
    this.maxPasswordLength = options.maxPasswordLength || 128;
  }

  /**
   * Generate secure password hash using bcrypt
   * @param {string} password - Plain text password
   * @returns {Promise<string>} Bcrypt hash
   */
  async hashPassword(password) {
    // Validate password
    this.validatePassword(password);
    
    try {
      const hash = await bcrypt.hash(password, this.saltRounds);
      return hash;
    } catch (error) {
      throw new Error(`Password hashing failed: ${error.message}`);
    }
  }

  /**
   * Verify password against hash
   * @param {string} password - Plain text password
   * @param {string} hash - Bcrypt hash
   * @returns {Promise<boolean>} True if password matches
   */
  async verifyPassword(password, hash) {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      throw new Error(`Password verification failed: ${error.message}`);
    }
  }

  /**
   * Validate password strength and format
   * @param {string} password - Password to validate
   * @throws {Error} If password is invalid
   */
  validatePassword(password) {
    if (typeof password !== 'string') {
      throw new Error('Password must be a string');
    }

    if (password.length < this.minPasswordLength) {
      throw new Error(`Password must be at least ${this.minPasswordLength} characters long`);
    }

    if (password.length > this.maxPasswordLength) {
      throw new Error(`Password must be no more than ${this.maxPasswordLength} characters long`);
    }

    // Check for basic complexity requirements
    const hasLowerCase = /[a-z]/.test(password);
    const hasUpperCase = /[A-Z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    const complexityCount = [hasLowerCase, hasUpperCase, hasNumbers, hasSpecialChar].filter(Boolean).length;

    if (complexityCount < 3) {
      throw new Error('Password must contain at least 3 of: lowercase letters, uppercase letters, numbers, special characters');
    }

    // Check for common weak patterns
    if (/(.)\1{2,}/.test(password)) {
      throw new Error('Password cannot contain repeated characters (3 or more in a row)');
    }

    if (/123|abc|qwe|password|admin/i.test(password)) {
      throw new Error('Password cannot contain common patterns or words');
    }
  }

  /**
   * Generate authentication configuration
   * @param {string} password - Plain text password
   * @param {Object} options - Configuration options
   * @returns {Promise<Object>} Authentication configuration
   */
  async generateAuthConfig(password, options = {}) {
    const hash = await this.hashPassword(password);
    
    return {
      enabled: true,
      password_hash: hash,
      session_timeout: options.sessionTimeout || 3600, // 1 hour default
      max_login_attempts: options.maxLoginAttempts || 5,
      lockout_duration: options.lockoutDuration || 900, // 15 minutes default
      require_https: options.requireHttps !== false, // Default to true
      secure_cookies: options.secureCookies !== false, // Default to true
      csrf_protection: options.csrfProtection !== false, // Default to true
      created_at: new Date().toISOString()
    };
  }

  /**
   * Save authentication configuration to file
   * @param {Object} authConfig - Authentication configuration
   * @param {string} configPath - Path to save configuration
   * @returns {Promise<void>}
   */
  async saveAuthConfig(authConfig, configPath) {
    try {
      // Ensure directory exists
      const configDir = path.dirname(configPath);
      await fs.mkdir(configDir, { recursive: true });
      
      // Write configuration with secure permissions
      const configJson = JSON.stringify(authConfig, null, 2);
      await fs.writeFile(configPath, configJson, { mode: 0o600 });
      
      console.log(`✅ Authentication configuration saved to: ${configPath}`);
      
    } catch (error) {
      throw new Error(`Failed to save authentication configuration: ${error.message}`);
    }
  }

  /**
   * Load authentication configuration from file
   * @param {string} configPath - Path to configuration file
   * @returns {Promise<Object>} Authentication configuration
   */
  async loadAuthConfig(configPath) {
    try {
      const configData = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Validate configuration structure
      if (!config.password_hash) {
        throw new Error('Invalid authentication configuration: missing password_hash');
      }
      
      return config;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Authentication configuration not found: ${configPath}`);
      }
      throw new Error(`Failed to load authentication configuration: ${error.message}`);
    }
  }

  /**
   * Update password in existing configuration
   * @param {string} configPath - Path to configuration file
   * @param {string} newPassword - New password
   * @param {string} currentPassword - Current password for verification
   * @returns {Promise<void>}
   */
  async updatePassword(configPath, newPassword, currentPassword) {
    // Load existing configuration
    const config = await this.loadAuthConfig(configPath);
    
    // Verify current password
    const isCurrentValid = await this.verifyPassword(currentPassword, config.password_hash);
    if (!isCurrentValid) {
      throw new Error('Current password is incorrect');
    }
    
    // Generate new hash
    const newHash = await this.hashPassword(newPassword);
    
    // Update configuration
    config.password_hash = newHash;
    config.updated_at = new Date().toISOString();
    
    // Save updated configuration
    await this.saveAuthConfig(config, configPath);
    
    console.log('✅ Password updated successfully');
  }

  /**
   * Generate secure random password
   * @param {number} length - Password length (default: 16)
   * @returns {string} Generated password
   */
  generateSecurePassword(length = 16) {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    
    const allChars = lowercase + uppercase + numbers + symbols;
    
    let password = '';
    
    // Ensure at least one character from each category
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];
    
    // Fill remaining length with random characters
    for (let i = 4; i < length; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Shuffle the password to avoid predictable patterns
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Check if authentication is properly configured
   * @param {string} configPath - Path to configuration file
   * @returns {Promise<Object>} Configuration status
   */
  async checkAuthStatus(configPath) {
    try {
      const config = await this.loadAuthConfig(configPath);
      
      return {
        configured: true,
        enabled: config.enabled,
        requiresHttps: config.require_https,
        sessionTimeout: config.session_timeout,
        maxLoginAttempts: config.max_login_attempts,
        createdAt: config.created_at,
        updatedAt: config.updated_at
      };
      
    } catch (error) {
      return {
        configured: false,
        error: error.message
      };
    }
  }
}

module.exports = { AuthManager };