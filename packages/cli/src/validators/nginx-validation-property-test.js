#!/usr/bin/env node

/**
 * @fileoverview nginx Configuration Validation Property Test
 * Comprehensive property-based testing for nginx configuration validation
 * **Property 34: nginx Configuration Validation**
 * **Validates: Requirements 10.3**
 */

const { NginxConfigValidator } = require('./nginx-validator');
const { NginxConfigGenerator } = require('../generators/nginx-config');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Generate test validation scenarios with various configurations
 * @returns {Array} Array of test validation scenarios
 */
function generateValidationTestScenarios() {
  return [
    // Valid configurations
    {
      name: 'valid-basic-site',
      type: 'valid',
      config: `
server {
    listen 80;
    server_name example.com;
    access_log /var/log/nginx/example.com.log analytics;
    error_log /var/log/nginx/example.com.error.log;
    
    location / {
        root /var/www/example.com;
        index index.html;
    }
}`,
      expectedValid: true
    },
    
    // Missing analytics log format
    {
      name: 'missing-analytics-format',
      type: 'invalid',
      config: `
server {
    listen 80;
    server_name example.com;
    access_log /var/log/nginx/example.com.log;
    
    location / {
        root /var/www/example.com;
    }
}`,
      expectedValid: false,
      expectedIssue: 'analytics log format'
    },
    
    // Syntax errors
    {
      name: 'syntax-error-missing-semicolon',
      type: 'invalid',
      config: `
server {
    listen 80
    server_name example.com;
    access_log /var/log/nginx/example.com.log analytics;
}`,
      expectedValid: false,
      expectedIssue: 'syntax'
    },
    
    // Unbalanced braces
    {
      name: 'unbalanced-braces',
      type: 'invalid',
      config: `
server {
    listen 80;
    server_name example.com;
    location / {
        root /var/www/example.com;
    # Missing closing brace
}`,
      expectedValid: false,
      expectedIssue: 'syntax'
    },
    
    // Valid SSL configuration
    {
      name: 'valid-ssl-site',
      type: 'valid',
      config: `
server {
    listen 80;
    server_name secure.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name secure.example.com;
    
    ssl_certificate /etc/ssl/certs/example.com.crt;
    ssl_certificate_key /etc/ssl/private/example.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    
    access_log /var/log/nginx/secure.example.com.log analytics;
    error_log /var/log/nginx/secure.example.com.error.log;
    
    location / {
        root /var/www/secure.example.com;
    }
}`,
      expectedValid: true
    }
  ];
}

/**
 * Create temporary test environment
 * @returns {Promise<string>} Path to temporary directory
 */
async function createTestEnvironment() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nginx-validation-test-'));
  
  // Create directory structure
  await fs.mkdir(path.join(tempDir, 'sites-available'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'sites-enabled'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'conf.d'), { recursive: true });
  
  // Create main nginx.conf with analytics log format
  const mainConfig = `
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    log_format analytics '$remote_addr - $remote_user [$time_local] '
                        '"$request" $status $body_bytes_sent '
                        '"$http_referer" "$http_user_agent" '
                        '$request_time';
    
    include ${tempDir}/sites-enabled/*;
}`;
  
  await fs.writeFile(path.join(tempDir, 'nginx.conf'), mainConfig);
  
  return tempDir;
}

/**
 * Cleanup test environment
 * @param {string} tempDir - Temporary directory path
 */
async function cleanupTestEnvironment(tempDir) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Property Test 1: Validation Consistency
 * For any configuration, validation should be consistent across multiple runs
 */
async function testValidationConsistency() {
  console.log('🔍 Property Test 1: Validation Consistency');
  
  const tempDir = await createTestEnvironment();
  
  try {
    const validator = new NginxConfigValidator({
      nginxConfigPath: path.join(tempDir, 'nginx.conf'),
      sitesAvailableDir: path.join(tempDir, 'sites-available'),
      sitesEnabledDir: path.join(tempDir, 'sites-enabled'),
      confDir: path.join(tempDir, 'conf.d')
    });
    
    const scenarios = generateValidationTestScenarios();
    
    for (const scenario of scenarios) {
      // Write test configuration
      const configPath = path.join(tempDir, 'sites-available', `${scenario.name}.conf`);
      await fs.writeFile(configPath, scenario.config);
      
      // Enable the site
      const enabledPath = path.join(tempDir, 'sites-enabled', `${scenario.name}.conf`);
      await fs.symlink(configPath, enabledPath);
      
      // Run validation multiple times
      const results = [];
      for (let i = 0; i < 3; i++) {
        const result = await validator.validateAnalyticsConfiguration();
        results.push(result);
      }
      
      // All results should be identical
      const firstResult = results[0];
      for (let i = 1; i < results.length; i++) {
        if (results[i] !== firstResult) {
          throw new Error(`Validation inconsistency for ${scenario.name}: ${results[i]} !== ${firstResult}`);
        }
      }
      
      // Clean up for next test
      await fs.unlink(enabledPath);
      await fs.unlink(configPath);
    }
    
    console.log(`   ✅ Tested ${scenarios.length} scenarios - all validation results consistent`);
    
  } finally {
    await cleanupTestEnvironment(tempDir);
  }
}

/**
 * Property Test 2: Error Detection Accuracy
 * For any invalid configuration, validation should detect and report errors
 */
async function testErrorDetectionAccuracy() {
  console.log('🔍 Property Test 2: Error Detection Accuracy');
  
  const tempDir = await createTestEnvironment();
  
  try {
    const validator = new NginxConfigValidator({
      nginxConfigPath: path.join(tempDir, 'nginx.conf'),
      sitesAvailableDir: path.join(tempDir, 'sites-available'),
      sitesEnabledDir: path.join(tempDir, 'sites-enabled'),
      confDir: path.join(tempDir, 'conf.d')
    });
    
    const invalidScenarios = generateValidationTestScenarios().filter(s => s.type === 'invalid');
    
    for (const scenario of invalidScenarios) {
      // Write invalid configuration
      const configPath = path.join(tempDir, 'sites-available', `${scenario.name}.conf`);
      await fs.writeFile(configPath, scenario.config);
      
      // Enable the site
      const enabledPath = path.join(tempDir, 'sites-enabled', `${scenario.name}.conf`);
      await fs.symlink(configPath, enabledPath);
      
      // Validation should detect the error
      const isValid = await validator.validateAnalyticsConfiguration();
      
      if (isValid && scenario.expectedValid === false) {
        throw new Error(`Validation failed to detect error in ${scenario.name}`);
      }
      
      // Clean up
      await fs.unlink(enabledPath);
      await fs.unlink(configPath);
    }
    
    console.log(`   ✅ Tested ${invalidScenarios.length} invalid scenarios - all errors detected`);
    
  } finally {
    await cleanupTestEnvironment(tempDir);
  }
}

/**
 * Property Test 3: Analytics Configuration Checking
 * For any configuration, analytics-specific validation should work correctly
 */
async function testAnalyticsConfigurationChecking() {
  console.log('🔍 Property Test 3: Analytics Configuration Checking');
  
  const tempDir = await createTestEnvironment();
  
  try {
    const validator = new NginxConfigValidator({
      nginxConfigPath: path.join(tempDir, 'nginx.conf'),
      sitesAvailableDir: path.join(tempDir, 'sites-available'),
      sitesEnabledDir: path.join(tempDir, 'sites-enabled'),
      confDir: path.join(tempDir, 'conf.d')
    });
    
    // Test log format detection
    const hasLogFormat = await validator.checkAnalyticsLogFormat();
    if (!hasLogFormat) {
      throw new Error('Analytics log format not detected in test environment');
    }
    
    // Test with sites using analytics format
    const generator = new NginxConfigGenerator();
    const testSite = {
      siteId: 'analytics-test',
      domain: 'analytics-test.com',
      logPath: '/var/log/nginx/analytics-test.log'
    };
    
    const siteConfig = generator.generateSiteConfig(testSite);
    const configPath = path.join(tempDir, 'sites-available', 'analytics-test.conf');
    const enabledPath = path.join(tempDir, 'sites-enabled', 'analytics-test.conf');
    
    await fs.writeFile(configPath, siteConfig);
    await fs.symlink(configPath, enabledPath);
    
    // Should detect sites with analytics logging
    const sitesWithAnalytics = await validator.checkSitesAnalyticsLogging();
    if (sitesWithAnalytics.length === 0) {
      throw new Error('Failed to detect site with analytics logging');
    }
    
    if (!sitesWithAnalytics.includes('analytics-test.conf')) {
      throw new Error('Analytics site not found in results');
    }
    
    console.log('   ✅ Analytics configuration checking works correctly');
    
  } finally {
    await cleanupTestEnvironment(tempDir);
  }
}

/**
 * Property Test 4: Site Configuration Validation
 * For any site configuration, individual site validation should work correctly
 */
async function testSiteConfigurationValidation() {
  console.log('🔍 Property Test 4: Site Configuration Validation');
  
  const tempDir = await createTestEnvironment();
  
  try {
    const validator = new NginxConfigValidator({
      nginxConfigPath: path.join(tempDir, 'nginx.conf'),
      sitesAvailableDir: path.join(tempDir, 'sites-available'),
      sitesEnabledDir: path.join(tempDir, 'sites-enabled'),
      confDir: path.join(tempDir, 'conf.d')
    });
    
    const generator = new NginxConfigGenerator();
    const testSites = [
      { siteId: 'site1', domain: 'site1.com', logPath: '/var/log/nginx/site1.log' },
      { siteId: 'site2', domain: 'site2.com', logPath: '/var/log/nginx/site2.log' },
      { siteId: 'site3', domain: 'site3.com', logPath: '/var/log/nginx/site3.log' }
    ];
    
    for (const site of testSites) {
      // Create site configuration
      const siteConfig = generator.generateSiteConfig(site);
      const configPath = path.join(tempDir, 'sites-available', `${site.siteId}.conf`);
      await fs.writeFile(configPath, siteConfig);
      
      // Test validation of available but not enabled site
      let results = await validator.validateSiteConfiguration(site.siteId);
      
      if (!results.exists) {
        throw new Error(`Site ${site.siteId} should exist`);
      }
      
      if (results.enabled) {
        throw new Error(`Site ${site.siteId} should not be enabled yet`);
      }
      
      // Enable the site
      const enabledPath = path.join(tempDir, 'sites-enabled', `${site.siteId}.conf`);
      await fs.symlink(configPath, enabledPath);
      
      // Test validation of enabled site
      results = await validator.validateSiteConfiguration(site.siteId);
      
      if (!results.enabled) {
        throw new Error(`Site ${site.siteId} should be enabled`);
      }
      
      if (!results.hasAnalyticsLogging) {
        throw new Error(`Site ${site.siteId} should have analytics logging`);
      }
    }
    
    // Test non-existent site
    const nonExistentResults = await validator.validateSiteConfiguration('non-existent');
    if (nonExistentResults.exists) {
      throw new Error('Non-existent site should not exist');
    }
    
    console.log(`   ✅ Tested ${testSites.length + 1} site configurations - all validations correct`);
    
  } finally {
    await cleanupTestEnvironment(tempDir);
  }
}

/**
 * Property Test 5: Validation Reliability
 * For any validation operation, the validator should handle errors gracefully
 */
async function testValidationReliability() {
  console.log('🔍 Property Test 5: Validation Reliability');
  
  // Test with non-existent directories
  const invalidValidator = new NginxConfigValidator({
    nginxConfigPath: '/non/existent/nginx.conf',
    sitesAvailableDir: '/non/existent/sites-available',
    sitesEnabledDir: '/non/existent/sites-enabled',
    confDir: '/non/existent/conf.d'
  });
  
  // Should not crash, should return appropriate results
  const logFormatResult = await invalidValidator.checkAnalyticsLogFormat();
  if (typeof logFormatResult !== 'boolean') {
    throw new Error('Log format check should return boolean even with invalid paths');
  }
  
  const sitesResult = await invalidValidator.checkSitesAnalyticsLogging();
  if (!Array.isArray(sitesResult)) {
    throw new Error('Sites check should return array even with invalid paths');
  }
  
  const permissionsResult = await invalidValidator.checkLogFilePermissions();
  if (!Array.isArray(permissionsResult)) {
    throw new Error('Permissions check should return array even with invalid paths');
  }
  
  const analyticsResult = await invalidValidator.validateAnalyticsConfiguration();
  if (typeof analyticsResult !== 'boolean') {
    throw new Error('Analytics validation should return boolean even with invalid paths');
  }
  
  // Test site validation with invalid site
  const siteResults = await invalidValidator.validateSiteConfiguration('invalid-site');
  if (typeof siteResults !== 'object' || !siteResults.hasOwnProperty('exists')) {
    throw new Error('Site validation should return proper results object');
  }
  
  console.log('   ✅ Validation handles errors gracefully and returns appropriate results');
}

/**
 * Property Test 6: Configuration Change Detection
 * For any configuration changes, validation should detect differences
 */
async function testConfigurationChangeDetection() {
  console.log('🔍 Property Test 6: Configuration Change Detection');
  
  const tempDir = await createTestEnvironment();
  
  try {
    const validator = new NginxConfigValidator({
      nginxConfigPath: path.join(tempDir, 'nginx.conf'),
      sitesAvailableDir: path.join(tempDir, 'sites-available'),
      sitesEnabledDir: path.join(tempDir, 'sites-enabled'),
      confDir: path.join(tempDir, 'conf.d')
    });
    
    // Initial state - no sites
    const initialSites = await validator.checkSitesAnalyticsLogging();
    
    // Add a site with analytics
    const generator = new NginxConfigGenerator();
    const testSite = {
      siteId: 'change-test',
      domain: 'change-test.com',
      logPath: '/var/log/nginx/change-test.log'
    };
    
    const siteConfig = generator.generateSiteConfig(testSite);
    const configPath = path.join(tempDir, 'sites-available', 'change-test.conf');
    const enabledPath = path.join(tempDir, 'sites-enabled', 'change-test.conf');
    
    await fs.writeFile(configPath, siteConfig);
    await fs.symlink(configPath, enabledPath);
    
    // Should detect the new site
    const updatedSites = await validator.checkSitesAnalyticsLogging();
    
    if (updatedSites.length <= initialSites.length) {
      throw new Error('Validator should detect new site with analytics logging');
    }
    
    if (!updatedSites.includes('change-test.conf')) {
      throw new Error('New site should be detected in analytics logging check');
    }
    
    // Remove analytics from site config
    const configWithoutAnalytics = siteConfig.replace(/analytics/g, 'combined');
    await fs.writeFile(configPath, configWithoutAnalytics);
    
    // Wait a moment for file system to update
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Debug: check what's in the file now
    const updatedConfig = await fs.readFile(configPath, 'utf8');
    if (updatedConfig.includes('analytics')) {
      throw new Error('File update failed - still contains analytics');
    }
    
    // Should detect the change
    const sitesAfterChange = await validator.checkSitesAnalyticsLogging();
    
    if (sitesAfterChange.includes('change-test.conf')) {
      throw new Error(`Site without analytics logging should not be detected. Config: ${updatedConfig.substring(0, 200)}...`);
    }
    
    console.log('   ✅ Configuration change detection works correctly');
    
  } finally {
    await cleanupTestEnvironment(tempDir);
  }
}

/**
 * Run all property tests for nginx configuration validation
 */
async function runAllPropertyTests() {
  console.log('🔍 nginx Configuration Validation Property Tests');
  console.log('===============================================');
  console.log('**Property 34: nginx Configuration Validation**');
  console.log('**Validates: Requirements 10.3**\n');

  try {
    await testValidationConsistency();
    await testErrorDetectionAccuracy();
    await testAnalyticsConfigurationChecking();
    await testSiteConfigurationValidation();
    await testValidationReliability();
    await testConfigurationChangeDetection();

    console.log('\n🎉 All Property Tests PASSED');
    console.log('   - Validation consistency across runs ✅');
    console.log('   - Error detection accuracy ✅');
    console.log('   - Analytics configuration checking ✅');
    console.log('   - Site configuration validation ✅');
    console.log('   - Validation reliability and error handling ✅');
    console.log('   - Configuration change detection ✅');
    console.log('\n📋 Requirements 10.3 validated: nginx configuration validation is correct');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Property Tests FAILED:', error.message);
    console.error(error.stack);
    return false;
  }
}

/**
 * Demonstrate validation edge cases
 */
async function demonstrateValidationEdgeCases() {
  console.log('\n🔍 Validation Edge Cases Demonstration');
  console.log('=====================================');
  
  const tempDir = await createTestEnvironment();
  
  try {
    const validator = new NginxConfigValidator({
      nginxConfigPath: path.join(tempDir, 'nginx.conf'),
      sitesAvailableDir: path.join(tempDir, 'sites-available'),
      sitesEnabledDir: path.join(tempDir, 'sites-enabled'),
      confDir: path.join(tempDir, 'conf.d')
    });
    
    // Test empty configuration directory
    const emptySites = await validator.checkSitesAnalyticsLogging();
    console.log(`✅ Empty directory handled: ${emptySites.length} sites found`);
    
    // Test configuration with comments and whitespace
    const configWithComments = `
# This is a test configuration
server {
    # Listen on port 80
    listen 80;
    
    # Server name
    server_name test.com;
    
    # Analytics logging
    access_log /var/log/nginx/test.log analytics;
    
    location / {
        root /var/www/test;
    }
}`;
    
    const commentConfigPath = path.join(tempDir, 'sites-available', 'comments-test.conf');
    const commentEnabledPath = path.join(tempDir, 'sites-enabled', 'comments-test.conf');
    
    await fs.writeFile(commentConfigPath, configWithComments);
    await fs.symlink(commentConfigPath, commentEnabledPath);
    
    const sitesWithComments = await validator.checkSitesAnalyticsLogging();
    if (!sitesWithComments.includes('comments-test.conf')) {
      throw new Error('Configuration with comments should be detected');
    }
    
    console.log('✅ Configuration with comments handled correctly');
    
    // Test broken symlink
    await fs.unlink(commentConfigPath); // Remove target, leave symlink
    
    const sitesWithBrokenLink = await validator.checkSitesAnalyticsLogging();
    console.log(`✅ Broken symlink handled: ${sitesWithBrokenLink.length} valid sites found`);
    
  } finally {
    await cleanupTestEnvironment(tempDir);
  }
}

async function main() {
  const testsPass = await runAllPropertyTests();
  await demonstrateValidationEdgeCases();
  
  if (!testsPass) {
    process.exit(1);
  }
  
  console.log('\n✅ Task 9.5 Complete: nginx configuration validation property tests passed');
}

if (require.main === module) {
  main();
}

module.exports = { 
  runAllPropertyTests, 
  demonstrateValidationEdgeCases,
  generateValidationTestScenarios,
  createTestEnvironment,
  cleanupTestEnvironment
};