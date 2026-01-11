#!/usr/bin/env node

/**
 * @fileoverview Verification script for authentication and systemd service functionality
 * Tests Task 9.6 implementation
 */

const { AuthManager } = require('./src/utils/auth-manager');
const { SystemdServiceGenerator } = require('./src/generators/systemd-service');
const { SetupCoordinator } = require('./src/setup/setup-coordinator');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function verifyAuthManager() {
  console.log('🔐 Testing AuthManager...');
  
  const authManager = new AuthManager();
  
  // Test password validation
  try {
    authManager.validatePassword('WeakPass');
    throw new Error('Should have rejected weak password');
  } catch (error) {
    if (!error.message.includes('Password must contain at least 3 of')) {
      throw error;
    }
  }
  console.log('   ✅ Password validation works');
  
  // Test password hashing
  const password = 'SecureKey789!';
  const hash = await authManager.hashPassword(password);
  const isValid = await authManager.verifyPassword(password, hash);
  if (!isValid) {
    throw new Error('Password verification failed');
  }
  console.log('   ✅ Password hashing and verification works');
  
  // Test auth config generation
  const authConfig = await authManager.generateAuthConfig(password, {
    sessionTimeout: 7200,
    requireHttps: true
  });
  
  if (!authConfig.password_hash || authConfig.session_timeout !== 7200) {
    throw new Error('Auth config generation failed');
  }
  console.log('   ✅ Authentication configuration generation works');
  
  // Test secure password generation
  const generatedPassword = authManager.generateSecurePassword(16);
  if (generatedPassword.length !== 16) {
    throw new Error('Secure password generation failed');
  }
  
  try {
    authManager.validatePassword(generatedPassword);
  } catch (error) {
    throw new Error(`Generated password is not valid: ${error.message}`);
  }
  console.log('   ✅ Secure password generation works');
  
  return true;
}

async function verifySystemdServiceGenerator() {
  console.log('⚙️  Testing SystemdServiceGenerator...');
  
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'systemd-test-'));
  
  try {
    const generator = new SystemdServiceGenerator({
      systemdDir: tempDir,
      serviceName: 'test-analytics',
      backupDir: path.join(tempDir, 'backups')
    });
    
    // Test service file generation
    const config = {
      outputDir: '/opt/analytics',
      configPath: '/etc/analytics/config.yaml'
    };
    
    const serviceContent = generator.generateServiceFile(config);
    if (!serviceContent.includes('[Unit]') || !serviceContent.includes('User=analytics')) {
      throw new Error('Service file generation failed');
    }
    console.log('   ✅ Service file generation works');
    
    // Test backup functionality
    const servicePath = path.join(tempDir, 'test-analytics.service');
    await fs.writeFile(servicePath, 'original content');
    
    const backupPath = await generator.createServiceBackup(servicePath);
    if (!backupPath || !backupPath.includes('backup')) {
      throw new Error('Service backup creation failed');
    }
    console.log('   ✅ Service backup functionality works');
    
    // Test service writing with rollback
    const result = await generator.writeServiceFileWithRollback(config);
    if (!result.success || typeof result.rollback !== 'function') {
      throw new Error('Service writing with rollback failed');
    }
    console.log('   ✅ Service writing with rollback works');
    
    // Test rollback functionality
    await result.rollback();
    const restoredContent = await fs.readFile(servicePath, 'utf8');
    if (restoredContent !== 'original content') {
      throw new Error('Service rollback failed');
    }
    console.log('   ✅ Service rollback functionality works');
    
    return true;
    
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function verifySetupCoordinator() {
  console.log('🚀 Testing SetupCoordinator...');
  
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-test-'));
  
  try {
    const coordinator = new SetupCoordinator({
      configDir: path.join(tempDir, 'config'),
      dataDir: path.join(tempDir, 'data'),
      systemd: {
        systemdDir: path.join(tempDir, 'systemd'),
        backupDir: path.join(tempDir, 'backups')
      }
    });
    
    // Test authentication setup
    const authResult = await coordinator.setupAuthentication({
      password: 'SecureKey789!',
      sessionTimeout: 3600,
      requireHttps: true
    });
    
    if (!authResult.success || !authResult.configPath) {
      throw new Error('Authentication setup failed');
    }
    console.log('   ✅ Authentication setup works');
    
    // Test systemd service setup
    const systemdResult = await coordinator.setupSystemdService({
      outputDir: path.join(tempDir, 'data'),
      configPath: path.join(tempDir, 'config', 'config.yaml')
    });
    
    if (!systemdResult.success || !systemdResult.servicePath) {
      throw new Error('systemd service setup failed');
    }
    console.log('   ✅ systemd service setup works');
    
    // Test rollback functionality
    await authResult.rollback();
    await systemdResult.rollback();
    console.log('   ✅ Setup rollback functionality works');
    
    return true;
    
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function verifySecurityFeatures() {
  console.log('🔒 Testing Security Features...');
  
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'security-test-'));
  
  try {
    const authManager = new AuthManager();
    
    // Test bcrypt cost factor
    const password = 'SecureKey789!';
    const hash = await authManager.hashPassword(password);
    
    // Verify bcrypt format and cost factor
    const bcryptRegex = /^\$2[aby]\$(\d+)\$/;
    const match = hash.match(bcryptRegex);
    if (!match) {
      throw new Error('Hash is not in bcrypt format');
    }
    
    const costFactor = parseInt(match[1], 10);
    if (costFactor < 12) {
      throw new Error(`Cost factor ${costFactor} is too low (should be >= 12)`);
    }
    console.log(`   ✅ bcrypt cost factor is appropriate (${costFactor})`);
    
    // Test file permissions
    const configPath = path.join(tempDir, 'auth.json');
    const config = await authManager.generateAuthConfig(password);
    await authManager.saveAuthConfig(config, configPath);
    
    const stats = await fs.stat(configPath);
    const permissions = stats.mode & 0o777;
    if (permissions !== 0o600) {
      throw new Error(`File permissions are ${permissions.toString(8)}, should be 600`);
    }
    console.log('   ✅ File permissions are secure (0600)');
    
    // Test HTTPS enforcement in config
    if (!config.require_https) {
      throw new Error('HTTPS enforcement is not enabled by default');
    }
    console.log('   ✅ HTTPS enforcement is enabled by default');
    
    // Test secure cookie settings
    if (!config.secure_cookies) {
      throw new Error('Secure cookies are not enabled by default');
    }
    console.log('   ✅ Secure cookies are enabled by default');
    
    return true;
    
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('🔍 Verifying Authentication and systemd Service Functionality');
  console.log('============================================================');
  
  try {
    await verifyAuthManager();
    await verifySystemdServiceGenerator();
    await verifySetupCoordinator();
    await verifySecurityFeatures();
    
    console.log('\n🎉 All Authentication and systemd Service Tests PASSED');
    console.log('   - AuthManager functionality ✅');
    console.log('   - SystemdServiceGenerator with rollback ✅');
    console.log('   - SetupCoordinator integration ✅');
    console.log('   - Security features (bcrypt, HTTPS, permissions) ✅');
    console.log('\n📋 Task 9.6 Requirements Validated:');
    console.log('   - Requirements 4.3: Authentication with bcrypt ✅');
    console.log('   - Requirements 4.5: systemd service generation ✅');
    console.log('   - Requirements 4.6: Rollback functionality ✅');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Authentication and systemd Service Tests FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { 
  verifyAuthManager,
  verifySystemdServiceGenerator,
  verifySetupCoordinator,
  verifySecurityFeatures
};