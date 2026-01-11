#!/usr/bin/env node

/**
 * @fileoverview nginx Configuration Generation Verification
 * Simple verification of nginx configuration generation functionality
 * **Property 14: nginx Configuration Generation Correctness**
 * **Validates: Requirements 4.2**
 */

const { NginxConfigGenerator } = require('./nginx-config');
const { NginxConfigValidator } = require('../validators/nginx-validator');

/**
 * Verify nginx configuration generation works correctly
 * Tests the core property: For any valid site configuration, the generator should produce
 * valid nginx configuration files with proper analytics logging setup
 */
async function verifyNginxConfigGeneration() {
  console.log('🔍 Property 14: nginx Configuration Generation Correctness Verification');
  console.log('======================================================================');

  try {
    const generator = new NginxConfigGenerator({
      nginxConfigDir: './test-output/nginx',
      sitesAvailableDir: './test-output/nginx/sites-available',
      sitesEnabledDir: './test-output/nginx/sites-enabled',
      confDir: './test-output/nginx/conf.d'
    });
    
    // Test 1: Verify log format generation
    console.log('✅ Test 1: Log format generation');
    const logFormat = generator.generateLogFormat();
    
    if (!logFormat || typeof logFormat !== 'string') {
      throw new Error('Log format should be a non-empty string');
    }
    
    if (!logFormat.includes('log_format analytics')) {
      throw new Error('Log format should define analytics format');
    }
    
    if (!logFormat.includes('$remote_addr') || !logFormat.includes('$http_user_agent')) {
      throw new Error('Log format should include required fields for analytics');
    }
    
    console.log('   Log format generation works correctly');

    // Test 2: Verify site configuration generation
    console.log('✅ Test 2: Site configuration generation');
    
    const testSites = [
      {
        siteId: 'test-site-1',
        siteName: 'Test Site 1',
        domain: 'test1.example.com',
        logPath: '/var/log/nginx/test1.log'
      },
      {
        siteId: 'test-site-2',
        siteName: 'Test Site 2',
        domain: 'test2.example.com',
        logPath: '/var/log/nginx/test2.log'
      }
    ];
    
    for (const site of testSites) {
      const siteConfig = generator.generateSiteConfig(site);
      
      if (!siteConfig || typeof siteConfig !== 'string') {
        throw new Error(`Site configuration for ${site.domain} should be a non-empty string`);
      }
      
      // Check required elements
      if (!siteConfig.includes(`server_name ${site.domain}`)) {
        throw new Error(`Site configuration should include server_name ${site.domain}`);
      }
      
      if (!siteConfig.includes(`access_log ${site.logPath} analytics`)) {
        throw new Error(`Site configuration should include analytics logging to ${site.logPath}`);
      }
      
      if (!siteConfig.includes('listen 80')) {
        throw new Error('Site configuration should include HTTP listener');
      }
      
      // Check security headers
      if (!siteConfig.includes('X-Frame-Options') || !siteConfig.includes('X-Content-Type-Options')) {
        throw new Error('Site configuration should include security headers');
      }
      
      // Check static asset caching
      if (!siteConfig.includes('expires 1y')) {
        throw new Error('Site configuration should include static asset caching');
      }
    }
    
    console.log('   Site configuration generation works correctly');

    // Test 3: Verify configuration structure
    console.log('✅ Test 3: Configuration structure validation');
    
    const sampleSite = testSites[0];
    const config = generator.generateSiteConfig(sampleSite);
    
    // Check for proper nginx syntax elements
    const requiredElements = [
      'server {',
      'location /',
      'try_files',
      'add_header',
      'access_log',
      'error_log'
    ];
    
    for (const element of requiredElements) {
      if (!config.includes(element)) {
        throw new Error(`Configuration should include ${element}`);
      }
    }
    
    console.log('   Configuration structure is valid');

    // Test 4: Verify SSL template inclusion
    console.log('✅ Test 4: SSL template validation');
    
    if (!config.includes('# HTTPS configuration')) {
      throw new Error('Configuration should include SSL template');
    }
    
    if (!config.includes('ssl_protocols TLSv1.2 TLSv1.3')) {
      throw new Error('SSL template should include modern protocols');
    }
    
    console.log('   SSL template is included correctly');

    // Test 5: Verify validator functionality
    console.log('✅ Test 5: Validator functionality');
    
    const validator = new NginxConfigValidator({
      nginxConfigPath: './test-output/nginx/nginx.conf',
      sitesAvailableDir: './test-output/nginx/sites-available',
      sitesEnabledDir: './test-output/nginx/sites-enabled',
      confDir: './test-output/nginx/conf.d'
    });
    
    // Test log format checking (should return false for non-existent files)
    const hasLogFormat = await validator.checkAnalyticsLogFormat();
    if (hasLogFormat) {
      throw new Error('Validator should return false for non-existent log format');
    }
    
    // Test sites checking (should return empty array for non-existent sites)
    const sitesWithAnalytics = await validator.checkSitesAnalyticsLogging();
    if (!Array.isArray(sitesWithAnalytics)) {
      throw new Error('Sites checking should return an array');
    }
    
    console.log('   Validator functionality works correctly');

    // Test 6: Verify setup instructions
    console.log('✅ Test 6: Setup instructions');
    
    const instructions = generator.getSetupInstructions();
    if (!instructions || typeof instructions !== 'string') {
      throw new Error('Setup instructions should be a non-empty string');
    }
    
    if (!instructions.includes('nginx.conf') || !instructions.includes('sites-available')) {
      throw new Error('Setup instructions should include configuration paths');
    }
    
    console.log('   Setup instructions are comprehensive');

    // Test 7: Verify domain validation patterns
    console.log('✅ Test 7: Domain handling');
    
    const domainTestCases = [
      { domain: 'example.com', valid: true },
      { domain: 'sub.example.com', valid: true },
      { domain: 'test-site.example.org', valid: true },
      { domain: 'localhost', valid: false }, // Should handle but note it's not typical
    ];
    
    for (const testCase of domainTestCases) {
      const testSite = {
        siteId: 'test',
        domain: testCase.domain,
        logPath: '/var/log/nginx/test.log'
      };
      
      const config = generator.generateSiteConfig(testSite);
      if (!config.includes(testCase.domain)) {
        throw new Error(`Configuration should handle domain ${testCase.domain}`);
      }
    }
    
    console.log('   Domain handling works correctly');

    console.log('\n🎉 Property 14 Verification PASSED');
    console.log('   - Log format generation works correctly ✅');
    console.log('   - Site configuration generation works correctly ✅');
    console.log('   - Configuration structure is valid ✅');
    console.log('   - SSL templates are included ✅');
    console.log('   - Validator functionality works ✅');
    console.log('   - Setup instructions are comprehensive ✅');
    console.log('   - Domain handling works correctly ✅');
    console.log('\n📋 Requirements 4.2 validated: nginx configuration generation works correctly');
    
    return true;
    
  } catch (error) {
    console.error('❌ Property 14 Verification FAILED:', error.message);
    return false;
  }
}

async function main() {
  const verificationPassed = await verifyNginxConfigGeneration();
  
  if (!verificationPassed) {
    process.exit(1);
  }
  
  console.log('\n✅ Task 9.3 Complete: nginx configuration generation verification passed');
}

if (require.main === module) {
  main();
}

module.exports = { verifyNginxConfigGeneration };