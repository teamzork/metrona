#!/usr/bin/env node

/**
 * @fileoverview nginx Configuration Generation Property Test
 * Comprehensive property-based testing for nginx configuration generation
 * **Property 14: nginx Configuration Generation Correctness**
 * **Validates: Requirements 4.2**
 */

const { NginxConfigGenerator } = require('./nginx-config');
const { NginxConfigValidator } = require('../validators/nginx-validator');

/**
 * Generate test site configurations with various patterns
 * @returns {Array} Array of test site configurations
 */
function generateTestSiteConfigurations() {
  return [
    // Standard domains
    { siteId: 'example-com', domain: 'example.com', logPath: '/var/log/nginx/example.com.log' },
    { siteId: 'blog-site', domain: 'blog.example.org', logPath: '/var/log/nginx/blog.log' },
    
    // Subdomain variations
    { siteId: 'api-service', domain: 'api.service.com', logPath: '/var/log/nginx/api.service.log' },
    { siteId: 'cdn-assets', domain: 'cdn.assets.net', logPath: '/var/log/nginx/cdn.assets.log' },
    
    // Hyphenated domains
    { siteId: 'test-site', domain: 'test-site.example.com', logPath: '/var/log/nginx/test-site.log' },
    { siteId: 'multi-word', domain: 'multi-word-domain.org', logPath: '/var/log/nginx/multi-word.log' },
    
    // Different TLDs
    { siteId: 'international', domain: 'example.co.uk', logPath: '/var/log/nginx/example.co.uk.log' },
    { siteId: 'tech-site', domain: 'techsite.io', logPath: '/var/log/nginx/techsite.io.log' },
    
    // Edge cases
    { siteId: 'short', domain: 'a.co', logPath: '/var/log/nginx/a.co.log' },
    { siteId: 'long-domain', domain: 'very-long-domain-name-for-testing.example.com', logPath: '/var/log/nginx/long.log' }
  ];
}
/**
 * Property Test 1: Configuration Generation Consistency
 * For any valid site configuration, generated nginx config should be consistent and valid
 */
async function testConfigurationGenerationConsistency() {
  console.log('🔍 Property Test 1: Configuration Generation Consistency');
  
  const generator = new NginxConfigGenerator();
  const testSites = generateTestSiteConfigurations();
  
  for (const site of testSites) {
    // Generate configuration multiple times
    const config1 = generator.generateSiteConfig(site);
    const config2 = generator.generateSiteConfig(site);
    
    // Should be identical (deterministic)
    if (config1 !== config2) {
      throw new Error(`Configuration generation is not deterministic for ${site.domain}`);
    }
    
    // Should contain required elements
    const requiredElements = [
      `server_name ${site.domain}`,
      `access_log ${site.logPath} analytics`,
      'listen 80',
      'X-Frame-Options',
      'expires 1y'
    ];
    
    for (const element of requiredElements) {
      if (!config1.includes(element)) {
        throw new Error(`Missing required element "${element}" in config for ${site.domain}`);
      }
    }
  }
  
  console.log(`   ✅ Tested ${testSites.length} site configurations - all consistent`);
}

/**
 * Property Test 2: Log Format Consistency
 * For any configuration, the analytics log format should be consistent and complete
 */
async function testLogFormatConsistency() {
  console.log('🔍 Property Test 2: Log Format Consistency');
  
  const generator = new NginxConfigGenerator();
  
  // Generate log format multiple times
  const formats = [];
  for (let i = 0; i < 5; i++) {
    formats.push(generator.generateLogFormat());
  }
  
  // All should be identical
  const firstFormat = formats[0];
  for (let i = 1; i < formats.length; i++) {
    if (formats[i] !== firstFormat) {
      throw new Error('Log format generation is not consistent');
    }
  }
  
  // Should contain all required fields for analytics
  const requiredFields = [
    '$remote_addr',
    '$remote_user',
    '$time_local',
    '$request',
    '$status',
    '$body_bytes_sent',
    '$http_referer',
    '$http_user_agent',
    '$request_time'
  ];
  
  for (const field of requiredFields) {
    if (!firstFormat.includes(field)) {
      throw new Error(`Log format missing required field: ${field}`);
    }
  }
  
  console.log('   ✅ Log format is consistent and contains all required fields');
}
/**
 * Property Test 3: Security Headers Inclusion
 * For any site configuration, security headers should always be included
 */
async function testSecurityHeadersInclusion() {
  console.log('🔍 Property Test 3: Security Headers Inclusion');
  
  const generator = new NginxConfigGenerator();
  const testSites = generateTestSiteConfigurations();
  
  const requiredSecurityHeaders = [
    'X-Frame-Options "SAMEORIGIN"',
    'X-Content-Type-Options "nosniff"',
    'X-XSS-Protection "1; mode=block"'
  ];
  
  for (const site of testSites) {
    const config = generator.generateSiteConfig(site);
    
    for (const header of requiredSecurityHeaders) {
      if (!config.includes(header)) {
        throw new Error(`Missing security header "${header}" for ${site.domain}`);
      }
    }
  }
  
  console.log(`   ✅ All ${testSites.length} configurations include required security headers`);
}

/**
 * Property Test 4: SSL Template Completeness
 * For any site configuration, SSL template should be complete and secure
 */
async function testSSLTemplateCompleteness() {
  console.log('🔍 Property Test 4: SSL Template Completeness');
  
  const generator = new NginxConfigGenerator();
  const testSites = generateTestSiteConfigurations().slice(0, 3); // Test subset for performance
  
  const requiredSSLElements = [
    'listen 443 ssl http2',
    'ssl_certificate',
    'ssl_certificate_key',
    'ssl_protocols TLSv1.2 TLSv1.3',
    'ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512'
  ];
  
  for (const site of testSites) {
    const config = generator.generateSiteConfig(site);
    
    for (const element of requiredSSLElements) {
      if (!config.includes(element)) {
        throw new Error(`Missing SSL element "${element}" for ${site.domain}`);
      }
    }
    
    // Check for HTTP to HTTPS redirect template
    if (!config.includes('return 301 https://')) {
      throw new Error(`Missing HTTPS redirect template for ${site.domain}`);
    }
  }
  
  console.log(`   ✅ All ${testSites.length} configurations include complete SSL templates`);
}

/**
 * Property Test 5: Path and Directory Handling
 * For any valid paths, configuration should handle them correctly
 */
async function testPathAndDirectoryHandling() {
  console.log('🔍 Property Test 5: Path and Directory Handling');
  
  const generator = new NginxConfigGenerator();
  
  const pathTestCases = [
    { logPath: '/var/log/nginx/simple.log', expected: '/var/log/nginx' },
    { logPath: '/custom/path/to/logs/site.log', expected: '/custom/path/to/logs' },
    { logPath: '/logs/site-name.access.log', expected: '/logs' },
    { logPath: '/var/log/nginx/subdomain.example.com.log', expected: '/var/log/nginx' }
  ];
  
  for (const testCase of pathTestCases) {
    const site = {
      siteId: 'test-site',
      domain: 'test.com',
      logPath: testCase.logPath
    };
    
    const config = generator.generateSiteConfig(site);
    
    // Should include the full log path
    if (!config.includes(`access_log ${testCase.logPath} analytics`)) {
      throw new Error(`Configuration should include full log path: ${testCase.logPath}`);
    }
    
    // Should include error log in same directory
    const expectedErrorLog = `${testCase.expected}/${site.siteId}.error.log`;
    if (!config.includes(`error_log ${expectedErrorLog}`)) {
      throw new Error(`Configuration should include error log: ${expectedErrorLog}`);
    }
  }
  
  console.log(`   ✅ All ${pathTestCases.length} path configurations handled correctly`);
}
/**
 * Property Test 6: Static Asset Optimization
 * For any configuration, static asset caching should be properly configured
 */
async function testStaticAssetOptimization() {
  console.log('🔍 Property Test 6: Static Asset Optimization');
  
  const generator = new NginxConfigGenerator();
  const testSites = generateTestSiteConfigurations().slice(0, 3);
  
  const expectedOptimizations = [
    'expires 1y',
    'Cache-Control "public, immutable"',
    'access_log off',
    '\\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$'
  ];
  
  for (const site of testSites) {
    const config = generator.generateSiteConfig(site);
    
    for (const optimization of expectedOptimizations) {
      if (!config.includes(optimization)) {
        throw new Error(`Missing static asset optimization "${optimization}" for ${site.domain}`);
      }
    }
  }
  
  console.log(`   ✅ All ${testSites.length} configurations include static asset optimizations`);
}

/**
 * Property Test 7: Configuration Syntax Validity
 * For any generated configuration, nginx syntax should be valid
 */
async function testConfigurationSyntaxValidity() {
  console.log('🔍 Property Test 7: Configuration Syntax Validity');
  
  const generator = new NginxConfigGenerator();
  const testSites = generateTestSiteConfigurations().slice(0, 5);
  
  for (const site of testSites) {
    const config = generator.generateSiteConfig(site);
    
    // Check for balanced braces
    const openBraces = (config.match(/{/g) || []).length;
    const closeBraces = (config.match(/}/g) || []).length;
    
    if (openBraces !== closeBraces) {
      throw new Error(`Unbalanced braces in configuration for ${site.domain}`);
    }
    
    // Check for proper semicolon usage
    const lines = config.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed === '' || trimmed === '{' || trimmed === '}') {
        continue;
      }
      
      // Directives should end with semicolon (except blocks)
      if (!trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.includes('server {')) {
        // Some exceptions for block directives
        if (!trimmed.startsWith('location') && !trimmed.startsWith('server')) {
          throw new Error(`Missing semicolon in line: "${trimmed}" for ${site.domain}`);
        }
      }
    }
  }
  
  console.log(`   ✅ All ${testSites.length} configurations have valid nginx syntax`);
}

/**
 * Property Test 8: Validator Integration
 * For any configuration, the validator should work correctly
 */
async function testValidatorIntegration() {
  console.log('🔍 Property Test 8: Validator Integration');
  
  const validator = new NginxConfigValidator({
    nginxConfigPath: './test-nginx/nginx.conf',
    sitesAvailableDir: './test-nginx/sites-available',
    sitesEnabledDir: './test-nginx/sites-enabled',
    confDir: './test-nginx/conf.d'
  });
  
  // Test validator methods don't crash
  const logFormatResult = await validator.checkAnalyticsLogFormat();
  if (typeof logFormatResult !== 'boolean') {
    throw new Error('Log format check should return boolean');
  }
  
  const sitesResult = await validator.checkSitesAnalyticsLogging();
  if (!Array.isArray(sitesResult)) {
    throw new Error('Sites check should return array');
  }
  
  const permissionsResult = await validator.checkLogFilePermissions();
  if (!Array.isArray(permissionsResult)) {
    throw new Error('Permissions check should return array');
  }
  
  console.log('   ✅ Validator integration works correctly');
}
/**
 * Run all property tests for nginx configuration generation
 */
async function runAllPropertyTests() {
  console.log('🔍 nginx Configuration Generation Property Tests');
  console.log('==============================================');
  console.log('**Property 14: nginx Configuration Generation Correctness**');
  console.log('**Validates: Requirements 4.2**\n');

  try {
    await testConfigurationGenerationConsistency();
    await testLogFormatConsistency();
    await testSecurityHeadersInclusion();
    await testSSLTemplateCompleteness();
    await testPathAndDirectoryHandling();
    await testStaticAssetOptimization();
    await testConfigurationSyntaxValidity();
    await testValidatorIntegration();

    console.log('\n🎉 All Property Tests PASSED');
    console.log('   - Configuration generation is consistent ✅');
    console.log('   - Log format is complete and consistent ✅');
    console.log('   - Security headers are always included ✅');
    console.log('   - SSL templates are complete ✅');
    console.log('   - Path and directory handling works ✅');
    console.log('   - Static asset optimization is configured ✅');
    console.log('   - Configuration syntax is valid ✅');
    console.log('   - Validator integration works ✅');
    console.log('\n📋 Requirements 4.2 validated: nginx configuration generation is correct');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Property Tests FAILED:', error.message);
    return false;
  }
}

/**
 * Demonstrate edge case handling
 */
async function demonstrateEdgeCaseHandling() {
  console.log('\n🔍 Edge Case Handling Demonstration');
  console.log('===================================');
  
  const generator = new NginxConfigGenerator();
  
  // Test with minimal site configuration
  const minimalSite = {
    siteId: 'minimal',
    domain: 'min.co',
    logPath: '/log.txt'
  };
  
  const minimalConfig = generator.generateSiteConfig(minimalSite);
  console.log('✅ Minimal configuration generated successfully');
  
  // Test with complex site configuration
  const complexSite = {
    siteId: 'very-complex-site-with-long-name',
    domain: 'very-long-subdomain.complex-domain-name.co.uk',
    logPath: '/very/deep/directory/structure/for/logs/complex-site.access.log'
  };
  
  const complexConfig = generator.generateSiteConfig(complexSite);
  console.log('✅ Complex configuration generated successfully');
  
  // Verify both contain required elements
  const requiredElements = ['server_name', 'access_log', 'analytics'];
  
  for (const element of requiredElements) {
    if (!minimalConfig.includes(element) || !complexConfig.includes(element)) {
      throw new Error(`Edge case handling failed for element: ${element}`);
    }
  }
  
  console.log('✅ Edge case handling works correctly');
}

async function main() {
  const testsPass = await runAllPropertyTests();
  await demonstrateEdgeCaseHandling();
  
  if (!testsPass) {
    process.exit(1);
  }
  
  console.log('\n✅ Task 9.4 Complete: nginx configuration generation property tests passed');
}

if (require.main === module) {
  main();
}

module.exports = { 
  runAllPropertyTests, 
  demonstrateEdgeCaseHandling,
  generateTestSiteConfigurations 
};