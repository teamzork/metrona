#!/usr/bin/env node

/**
 * @fileoverview CLI Security Features Property Tests
 * Comprehensive property-based testing for CLI security features
 * **Property 15: Comprehensive Authentication Security**
 * **Property 16: Service File Generation Correctness**
 * **Property 17: Error Recovery and Rollback**
 * **Validates: Requirements 4.3, 4.5, 4.6**
 */

const { AuthManager } = require('../utils/auth-manager');
const { SystemdServiceGenerator } = require('../generators/systemd-service');
const { SetupCoordinator } = require('../setup/setup-coordinator');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Generate test password variations for property testing
 * @returns {Array} Array of test passwords with different characteristics
 */
function generateTestPasswords() {
  return [
    // Valid strong passwords
    'SecureKey789!',
    'MyStr0ng#Hash',
    'C0mplex$Word',
    'Rand0m&Secure',
    'Test1ng@Auth',
    
    // Edge cases - valid but at boundaries
    'MinLen8!A',  // Minimum length
    'VeryLongButValidKey456!@#XyZvUtSrPoNmLkJiHgFeDc',  // Long but valid
    
    // Different complexity combinations
    'NoNumbers!@#XYZ',  // No numbers but has other complexity
    'nonumbers456!@#',  // No uppercase but has other complexity
    'NOLOWERCASE789!',  // No lowercase but has other complexity
    'NoSpecialChars456Xyz',  // No special chars but has other complexity
    
    // Valid passwords with various patterns
    'Unique$Pattern456',
    'Different&Style789',
    'Another#Format012',
    
    // Additional valid variations
    'Complex!Key1Word',
    'Secure@Auth2Key',
    'Strong#Hash3Code'
  ];
}

/**
 * Generate invalid passwords for testing validation
 * @returns {Array} Array of invalid passwords
 */
function generateInvalidPasswords() {
  return [
    // Too short
    'Short1!',
    'A1!',
    
    // Too long (over 128 characters)
    'A'.repeat(130) + '1!a',
    
    // Insufficient complexity
    'onlylowercase',
    'ONLYUPPERCASE',
    '1234567890',
    '!@#$%^&*()',
    'Simple123',  // Only 2 types
    
    // Repeated characters
    'Passsss123!',
    'Test111@#',
    
    // Common patterns
    'Password123!',
    'Admin123!',
    'Qwerty123!',
    'Abc123!@#',
    
    // Non-string types
    null,
    undefined,
    123,
    [],
    {}
  ];
}

/**
 * Generate test service configurations
 * @returns {Array} Array of service configuration objects
 */
function generateServiceConfigurations() {
  return [
    // Standard configurations
    {
      outputDir: '/opt/analytics',
      configPath: '/etc/analytics/config.yaml'
    },
    {
      outputDir: '/var/analytics/data',
      configPath: '/etc/analytics/system.yaml'
    },
    
    // Different path patterns
    {
      outputDir: '/home/analytics/data',
      configPath: '/home/analytics/config.yaml'
    },
    {
      outputDir: '/srv/analytics',
      configPath: '/srv/analytics/config.yaml'
    },
    
    // Edge cases
    {
      outputDir: '/tmp/analytics-test',
      configPath: '/tmp/analytics-test/config.yaml'
    },
    {
      outputDir: '/analytics',
      configPath: '/analytics.yaml'
    }
  ];
}

/**
 * Property Test 1: Comprehensive Authentication Security
 * For any password input, the system should generate bcrypt hashes with appropriate cost factors
 */
async function testComprehensiveAuthenticationSecurity() {
  console.log('🔍 Property Test 1: Comprehensive Authentication Security');
  
  const authManager = new AuthManager();
  const validPasswords = generateTestPasswords();
  const invalidPasswords = generateInvalidPasswords();
  
  // Test 1.1: Valid passwords should hash successfully with appropriate cost factors
  for (const password of validPasswords) {
    try {
      const hash = await authManager.hashPassword(password);
      
      // Verify bcrypt format
      const bcryptRegex = /^\$2[aby]\$(\d+)\$/;
      const match = hash.match(bcryptRegex);
      if (!match) {
        throw new Error(`Hash for "${password}" is not in bcrypt format: ${hash}`);
      }
      
      // Verify cost factor is appropriate (>= 12)
      const costFactor = parseInt(match[1], 10);
      if (costFactor < 12) {
        throw new Error(`Cost factor ${costFactor} is too low for password "${password}"`);
      }
      
      // Verify password verification works
      const isValid = await authManager.verifyPassword(password, hash);
      if (!isValid) {
        throw new Error(`Password verification failed for "${password}"`);
      }
      
      // Verify different hashes for same password (salt randomization)
      const hash2 = await authManager.hashPassword(password);
      if (hash === hash2) {
        throw new Error(`Same hash generated twice for password "${password}" - salt not random`);
      }
      
    } catch (error) {
      throw new Error(`Valid password "${password}" failed: ${error.message}`);
    }
  }
  
  // Test 1.2: Invalid passwords should be rejected
  for (const password of invalidPasswords) {
    try {
      await authManager.hashPassword(password);
      throw new Error(`Invalid password should have been rejected: ${password}`);
    } catch (error) {
      // Expected to fail - verify it's a validation error, not a system error
      if (!error.message.includes('Password') && !error.message.includes('string')) {
        throw new Error(`Unexpected error for invalid password "${password}": ${error.message}`);
      }
    }
  }
  
  // Test 1.3: Authentication configuration should enforce security defaults
  const testPassword = 'SecureKey789!';
  const authConfig = await authManager.generateAuthConfig(testPassword);
  
  // Verify HTTPS enforcement
  if (!authConfig.require_https) {
    throw new Error('HTTPS enforcement should be enabled by default');
  }
  
  // Verify secure cookies
  if (!authConfig.secure_cookies) {
    throw new Error('Secure cookies should be enabled by default');
  }
  
  // Verify CSRF protection
  if (!authConfig.csrf_protection) {
    throw new Error('CSRF protection should be enabled by default');
  }
  
  // Verify reasonable session timeout
  if (authConfig.session_timeout < 300 || authConfig.session_timeout > 86400) {
    throw new Error(`Session timeout ${authConfig.session_timeout} is not reasonable (should be 300-86400 seconds)`);
  }
  
  // Verify rate limiting configuration
  if (authConfig.max_login_attempts < 3 || authConfig.max_login_attempts > 10) {
    throw new Error(`Max login attempts ${authConfig.max_login_attempts} is not reasonable (should be 3-10)`);
  }
  
  console.log(`   ✅ Tested ${validPasswords.length} valid passwords - all secure`);
  console.log(`   ✅ Tested ${invalidPasswords.length} invalid passwords - all rejected`);
  console.log('   ✅ Authentication configuration enforces security defaults');
}

/**
 * Property Test 2: Service File Generation Correctness
 * For any systemd service generation request, created service files should contain required sections
 */
async function testServiceFileGenerationCorrectness() {
  console.log('🔍 Property Test 2: Service File Generation Correctness');
  
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'service-test-'));
  
  try {
    const serviceConfigs = generateServiceConfigurations();
    
    for (const config of serviceConfigs) {
      const generator = new SystemdServiceGenerator({
        systemdDir: tempDir,
        serviceName: 'test-analytics',
        user: 'analytics',
        group: 'analytics'
      });
      
      // Test service file generation
      const serviceContent = generator.generateServiceFile(config);
      
      // Verify required sections exist
      const requiredSections = ['[Unit]', '[Service]', '[Install]'];
      for (const section of requiredSections) {
        if (!serviceContent.includes(section)) {
          throw new Error(`Missing required section "${section}" in service file for config: ${JSON.stringify(config)}`);
        }
      }
      
      // Verify required Unit section fields
      const requiredUnitFields = [
        'Description=',
        'After=network.target',
        'Wants=nginx.service'
      ];
      for (const field of requiredUnitFields) {
        if (!serviceContent.includes(field)) {
          throw new Error(`Missing required Unit field "${field}" for config: ${JSON.stringify(config)}`);
        }
      }
      
      // Verify required Service section fields
      const requiredServiceFields = [
        'Type=simple',
        'User=analytics',
        'Group=analytics',
        `WorkingDirectory=${config.outputDir}`,
        `CONFIG_PATH=${config.configPath}`,
        'ExecStart=',
        'Restart=always'
      ];
      for (const field of requiredServiceFields) {
        if (!serviceContent.includes(field)) {
          throw new Error(`Missing required Service field "${field}" for config: ${JSON.stringify(config)}`);
        }
      }
      
      // Verify security settings
      const requiredSecuritySettings = [
        'NoNewPrivileges=true',
        'PrivateTmp=true',
        'ProtectSystem=strict',
        'ProtectHome=true'
      ];
      for (const setting of requiredSecuritySettings) {
        if (!serviceContent.includes(setting)) {
          throw new Error(`Missing security setting "${setting}" for config: ${JSON.stringify(config)}`);
        }
      }
      
      // Verify resource limits
      const requiredResourceLimits = [
        'LimitNOFILE=',
        'LimitNPROC='
      ];
      for (const limit of requiredResourceLimits) {
        if (!serviceContent.includes(limit)) {
          throw new Error(`Missing resource limit "${limit}" for config: ${JSON.stringify(config)}`);
        }
      }
      
      // Verify Install section
      if (!serviceContent.includes('WantedBy=multi-user.target')) {
        throw new Error(`Missing Install target for config: ${JSON.stringify(config)}`);
      }
      
      // Test file writing with correct permissions
      const result = await generator.writeServiceFileWithRollback(config);
      
      if (!result.success) {
        throw new Error(`Service file writing failed for config: ${JSON.stringify(config)}`);
      }
      
      // Verify file permissions (should be 0644)
      const stats = await fs.stat(result.servicePath);
      const permissions = stats.mode & 0o777;
      if (permissions !== 0o644) {
        throw new Error(`Service file permissions are ${permissions.toString(8)}, should be 644 for config: ${JSON.stringify(config)}`);
      }
      
      // Test rollback functionality
      if (typeof result.rollback !== 'function') {
        throw new Error(`Rollback function not provided for config: ${JSON.stringify(config)}`);
      }
    }
    
    console.log(`   ✅ Tested ${serviceConfigs.length} service configurations - all correct`);
    console.log('   ✅ All service files contain required sections and security settings');
    console.log('   ✅ All service files have correct permissions (0644)');
    
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Property Test 3: Error Recovery and Rollback
 * For any configuration error or validation failure, rollback functionality should restore previous state
 */
async function testErrorRecoveryAndRollback() {
  console.log('🔍 Property Test 3: Error Recovery and Rollback');
  
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rollback-test-'));
  
  try {
    // Test 3.1: Authentication configuration rollback
    const authManager = new AuthManager();
    const configPath = path.join(tempDir, 'auth.json');
    
    // Create initial configuration
    const initialConfig = await authManager.generateAuthConfig('InitialKey789!');
    await authManager.saveAuthConfig(initialConfig, configPath);
    const initialContent = await fs.readFile(configPath, 'utf8');
    
    // Simulate configuration update and rollback
    const coordinator = new SetupCoordinator({
      configDir: tempDir,
      systemd: { systemdDir: path.join(tempDir, 'systemd') }
    });
    
    const authResult = await coordinator.setupAuthentication({
      password: 'UpdatedKey456!',
      sessionTimeout: 7200
    });
    
    // Verify configuration was updated
    const updatedContent = await fs.readFile(configPath, 'utf8');
    if (updatedContent === initialContent) {
      throw new Error('Configuration was not updated');
    }
    
    // Execute rollback
    await authResult.rollback();
    
    // Verify configuration was restored (file should be removed since it's a new setup)
    try {
      await fs.access(configPath);
      throw new Error('Configuration file should have been removed by rollback');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    // Test 3.2: systemd service rollback
    const generator = new SystemdServiceGenerator({
      systemdDir: path.join(tempDir, 'systemd'),
      serviceName: 'test-service',
      backupDir: path.join(tempDir, 'backups')
    });
    
    const servicePath = path.join(tempDir, 'systemd', 'test-service.service');
    const originalServiceContent = 'original service content';
    
    // Create systemd directory and original service file
    await fs.mkdir(path.dirname(servicePath), { recursive: true });
    await fs.writeFile(servicePath, originalServiceContent);
    
    // Generate new service with rollback capability
    const serviceConfig = {
      outputDir: '/opt/test',
      configPath: '/etc/test/config.yaml'
    };
    
    const serviceResult = await generator.writeServiceFileWithRollback(serviceConfig);
    
    // Verify service was updated
    const updatedServiceContent = await fs.readFile(servicePath, 'utf8');
    if (updatedServiceContent === originalServiceContent) {
      throw new Error('Service file was not updated');
    }
    
    // Execute rollback
    await serviceResult.rollback();
    
    // Verify service was restored
    const restoredServiceContent = await fs.readFile(servicePath, 'utf8');
    if (restoredServiceContent !== originalServiceContent) {
      throw new Error('Service file was not properly restored by rollback');
    }
    
    // Test 3.3: Complete setup rollback
    const setupConfig = {
      authentication: {
        enabled: true,
        password: 'SetupTest456!',
        sessionTimeout: 3600
      },
      systemd: {
        enabled: true,
        outputDir: path.join(tempDir, 'data'),
        configPath: path.join(tempDir, 'config.yaml')
      }
    };
    
    const setupResult = await coordinator.performCompleteSetup(setupConfig);
    
    if (!setupResult.success) {
      throw new Error('Complete setup should have succeeded');
    }
    
    // Verify setup created files
    const authConfigExists = await fs.access(path.join(tempDir, 'auth.json')).then(() => true).catch(() => false);
    if (!authConfigExists) {
      throw new Error('Authentication configuration should exist after setup');
    }
    
    // Execute complete rollback
    await setupResult.rollback();
    
    // Verify all files were cleaned up
    const authConfigExistsAfterRollback = await fs.access(path.join(tempDir, 'auth.json')).then(() => true).catch(() => false);
    if (authConfigExistsAfterRollback) {
      throw new Error('Authentication configuration should be removed after rollback');
    }
    
    console.log('   ✅ Authentication configuration rollback works correctly');
    console.log('   ✅ systemd service rollback works correctly');
    console.log('   ✅ Complete setup rollback works correctly');
    
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Property Test 4: File Security Permissions
 * For any sensitive file created by the system, permissions should be restrictive
 */
async function testFileSecurityPermissions() {
  console.log('🔍 Property Test 4: File Security Permissions');
  
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'permissions-test-'));
  
  try {
    const authManager = new AuthManager();
    
    // Test authentication configuration file permissions
    const authConfigs = [
      { password: 'TestKey456!', path: path.join(tempDir, 'auth1.json') },
      { password: 'SecureKey789!', path: path.join(tempDir, 'auth2.json') },
      { password: 'AnotherKey012!', path: path.join(tempDir, 'subdir', 'auth3.json') }
    ];
    
    for (const { password, path: configPath } of authConfigs) {
      const config = await authManager.generateAuthConfig(password);
      await authManager.saveAuthConfig(config, configPath);
      
      // Verify file permissions are 0600
      const stats = await fs.stat(configPath);
      const permissions = stats.mode & 0o777;
      if (permissions !== 0o600) {
        throw new Error(`Auth config file ${configPath} has permissions ${permissions.toString(8)}, should be 600`);
      }
    }
    
    // Test service file permissions (should be 0644)
    const generator = new SystemdServiceGenerator({
      systemdDir: tempDir,
      serviceName: 'test-service'
    });
    
    const serviceConfig = {
      outputDir: '/opt/test',
      configPath: '/etc/test/config.yaml'
    };
    
    const result = await generator.writeServiceFileWithRollback(serviceConfig);
    
    const serviceStats = await fs.stat(result.servicePath);
    const servicePermissions = serviceStats.mode & 0o777;
    if (servicePermissions !== 0o644) {
      throw new Error(`Service file has permissions ${servicePermissions.toString(8)}, should be 644`);
    }
    
    console.log(`   ✅ Tested ${authConfigs.length} authentication config files - all have secure permissions (0600)`);
    console.log('   ✅ Service files have correct permissions (0644)');
    
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Property Test 5: Cross-Component Security Integration
 * For any complete setup, all security features should work together correctly
 */
async function testCrossComponentSecurityIntegration() {
  console.log('🔍 Property Test 5: Cross-Component Security Integration');
  
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-test-'));
  
  try {
    const coordinator = new SetupCoordinator({
      configDir: path.join(tempDir, 'config'),
      dataDir: path.join(tempDir, 'data'),
      systemd: {
        systemdDir: path.join(tempDir, 'systemd'),
        backupDir: path.join(tempDir, 'backups')
      }
    });
    
    // Test various setup configurations
    const setupConfigurations = [
      {
        name: 'minimal-setup',
        config: {
          authentication: {
            enabled: true,
            password: 'MinimalKey456!',
            requireHttps: true
          },
          systemd: {
            enabled: true,
            outputDir: path.join(tempDir, 'data1')
          }
        }
      },
      {
        name: 'full-setup',
        config: {
          authentication: {
            enabled: true,
            password: 'FullSetupKey789!',
            sessionTimeout: 7200,
            maxLoginAttempts: 3,
            requireHttps: true,
            secureCookies: true
          },
          systemd: {
            enabled: true,
            outputDir: path.join(tempDir, 'data2'),
            configPath: path.join(tempDir, 'config', 'full.yaml')
          }
        }
      }
    ];
    
    for (const { name, config } of setupConfigurations) {
      // Perform setup
      const setupResult = await coordinator.performCompleteSetup(config);
      
      if (!setupResult.success) {
        throw new Error(`Setup ${name} should have succeeded`);
      }
      
      // Validate security integration
      const validation = await coordinator.validateSetup(setupResult);
      
      if (!validation.valid) {
        throw new Error(`Setup ${name} validation failed: ${validation.error || 'Unknown error'}`);
      }
      
      // Verify all components are properly secured
      for (const result of validation.results) {
        if (!result.valid) {
          throw new Error(`Component ${result.component} validation failed for setup ${name}`);
        }
      }
      
      // Test rollback functionality
      await setupResult.rollback();
      
      // Verify rollback cleaned up properly
      const postRollbackValidation = await coordinator.validateSetup(setupResult);
      if (postRollbackValidation.valid) {
        throw new Error(`Setup ${name} should be invalid after rollback`);
      }
    }
    
    console.log(`   ✅ Tested ${setupConfigurations.length} setup configurations - all secure`);
    console.log('   ✅ Cross-component security integration works correctly');
    console.log('   ✅ Setup validation and rollback work correctly');
    
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Run all property tests for CLI security features
 */
async function runAllPropertyTests() {
  console.log('🔍 CLI Security Features Property Tests');
  console.log('======================================');
  console.log('**Property 15: Comprehensive Authentication Security**');
  console.log('**Property 16: Service File Generation Correctness**');
  console.log('**Property 17: Error Recovery and Rollback**');
  console.log('**Validates: Requirements 4.3, 4.5, 4.6**\n');

  try {
    await testComprehensiveAuthenticationSecurity();
    await testServiceFileGenerationCorrectness();
    await testErrorRecoveryAndRollback();
    await testFileSecurityPermissions();
    await testCrossComponentSecurityIntegration();

    console.log('\n🎉 All Property Tests PASSED');
    console.log('   - Comprehensive authentication security ✅');
    console.log('   - Service file generation correctness ✅');
    console.log('   - Error recovery and rollback ✅');
    console.log('   - File security permissions ✅');
    console.log('   - Cross-component security integration ✅');
    console.log('\n📋 Requirements Validated:');
    console.log('   - Requirements 4.3: Authentication with bcrypt and security defaults ✅');
    console.log('   - Requirements 4.5: systemd service generation with correct permissions ✅');
    console.log('   - Requirements 4.6: Error recovery and rollback functionality ✅');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Property Tests FAILED:', error.message);
    console.error(error.stack);
    return false;
  }
}

async function main() {
  const testsPass = await runAllPropertyTests();
  
  if (!testsPass) {
    process.exit(1);
  }
  
  console.log('\n✅ Task 9.7 Complete: CLI security features property tests passed');
}

if (require.main === module) {
  main();
}

module.exports = { 
  runAllPropertyTests,
  testComprehensiveAuthenticationSecurity,
  testServiceFileGenerationCorrectness,
  testErrorRecoveryAndRollback,
  testFileSecurityPermissions,
  testCrossComponentSecurityIntegration
};