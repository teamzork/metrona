#!/usr/bin/env node

/**
 * @fileoverview CLI Package Functionality Verification
 * Simple verification script to test CLI components without Jest complexity
 */

const { DependencyChecker } = require('./src/utils/dependency-checker');
const { NginxConfigGenerator } = require('./src/generators/nginx-config');
const { NginxConfigValidator } = require('./src/validators/nginx-validator');
const { SystemdServiceGenerator } = require('./src/generators/systemd-service');

async function verifyCLIComponents() {
  console.log('🔍 Verifying CLI Package Components');
  console.log('===================================');
  
  try {
    // Test DependencyChecker
    console.log('📦 Testing DependencyChecker...');
    const depChecker = new DependencyChecker();
    const depResults = await depChecker.checkAllDependencies();
    console.log(`   ✅ Dependency check: ${depResults.results.length} dependencies checked`);
    
    // Find Node.js result
    const nodeResult = depResults.results.find(r => r.name === 'Node.js');
    if (nodeResult) {
      console.log(`   ✅ Node.js: ${nodeResult.satisfied ? 'satisfied' : 'not satisfied'}`);
    }
    
    // Test NginxConfigGenerator
    console.log('🔧 Testing NginxConfigGenerator...');
    const nginxGen = new NginxConfigGenerator();
    const logFormat = nginxGen.generateLogFormat();
    if (logFormat.includes('$remote_addr') && logFormat.includes('analytics')) {
      console.log('   ✅ Log format generation works');
    } else {
      throw new Error('Log format generation failed');
    }
    
    const siteConfig = nginxGen.generateSiteConfig({
      siteId: 'test-site',
      domain: 'test.com',
      logPath: '/var/log/nginx/test.log'
    });
    if (siteConfig.includes('server_name test.com') && siteConfig.includes('analytics')) {
      console.log('   ✅ Site configuration generation works');
    } else {
      throw new Error('Site configuration generation failed');
    }
    
    // Test NginxConfigValidator
    console.log('✅ Testing NginxConfigValidator...');
    const nginxValidator = new NginxConfigValidator({
      nginxConfigPath: './test-nginx.conf',
      sitesAvailableDir: './test-sites-available',
      sitesEnabledDir: './test-sites-enabled',
      confDir: './test-conf.d'
    });
    
    // Should not crash with non-existent paths
    const logFormatCheck = await nginxValidator.checkAnalyticsLogFormat();
    const sitesCheck = await nginxValidator.checkSitesAnalyticsLogging();
    const permissionsCheck = await nginxValidator.checkLogFilePermissions();
    
    console.log('   ✅ Validator handles missing files gracefully');
    
    // Test SystemdServiceGenerator
    console.log('⚙️  Testing SystemdServiceGenerator...');
    const systemdGen = new SystemdServiceGenerator();
    const serviceConfig = systemdGen.generateServiceFile({
      outputDir: '/opt/analytics',
      configPath: '/etc/analytics/config.yaml'
    });
    
    if (serviceConfig.includes('[Unit]') && serviceConfig.includes('ExecStart')) {
      console.log('   ✅ Systemd service generation works');
    } else {
      throw new Error('Systemd service generation failed');
    }
    
    console.log('\n🎉 All CLI Components Verified Successfully');
    console.log('   - DependencyChecker ✅');
    console.log('   - NginxConfigGenerator ✅');
    console.log('   - NginxConfigValidator ✅');
    console.log('   - SystemdServiceGenerator ✅');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ CLI Component Verification Failed:', error.message);
    return false;
  }
}

async function main() {
  const success = await verifyCLIComponents();
  
  if (success) {
    console.log('\n✅ CLI Package Verification Complete');
    process.exit(0);
  } else {
    console.error('\n❌ CLI Package Verification Failed');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { verifyCLIComponents };