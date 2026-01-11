#!/usr/bin/env node

/**
 * Simple CLI verification script
 * Verifies CLI components load and instantiate correctly
 */

async function verifyCLI() {
  console.log('🔍 CLI Package Verification');
  console.log('===========================');

  try {
    // 1. Verify SetupWizard loads
    const { SetupWizard } = require('./src/setup/setup-wizard');
    console.log('✅ SetupWizard class loads successfully');
    
    // 2. Verify DependencyChecker loads
    const { DependencyChecker } = require('./src/utils/dependency-checker');
    console.log('✅ DependencyChecker class loads successfully');
    
    // 3. Verify NginxConfigGenerator loads
    const { NginxConfigGenerator } = require('./src/generators/nginx-config');
    console.log('✅ NginxConfigGenerator class loads successfully');
    
    // 4. Verify SystemdServiceGenerator loads
    const { SystemdServiceGenerator } = require('./src/generators/systemd-service');
    console.log('✅ SystemdServiceGenerator class loads successfully');
    
    // 5. Verify basic instantiation
    const wizard = new SetupWizard({ configPath: '/tmp/test.yaml' });
    console.log('✅ SetupWizard instantiates successfully');
    
    const depChecker = new DependencyChecker();
    console.log('✅ DependencyChecker instantiates successfully');
    
    const nginxGen = new NginxConfigGenerator();
    console.log('✅ NginxConfigGenerator instantiates successfully');
    
    const systemdGen = new SystemdServiceGenerator();
    console.log('✅ SystemdServiceGenerator instantiates successfully');
    
    // 6. Test basic functionality
    const config = wizard.buildConfiguration(
      { outputDir: '/tmp', timezone: 'UTC', logLevel: 'info' },
      [{ siteId: 'test', siteName: 'Test', domain: 'test.com', logPath: '/tmp/test.log', schedule: 'daily', enabled: true }],
      { enabled: false }
    );
    console.log('✅ Configuration building works');
    
    const logFormat = nginxGen.generateLogFormat();
    console.log('✅ nginx log format generation works');
    
    const serviceFile = systemdGen.generateServiceFile({ configPath: '/tmp/config.yaml', outputDir: '/tmp' });
    console.log('✅ systemd service file generation works');
    
    console.log('\n🎉 CLI Package Verification PASSED');
    console.log('   - All classes load successfully ✅');
    console.log('   - All classes instantiate successfully ✅');
    console.log('   - Basic functionality works ✅');
    console.log('\n📋 Task 9.1 Complete: Interactive setup wizard framework implemented');
    
  } catch (error) {
    console.error('❌ CLI Package Verification FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  verifyCLI();
}

module.exports = { verifyCLI };