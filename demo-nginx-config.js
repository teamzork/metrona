#!/usr/bin/env node

/**
 * @fileoverview Demo script for nginx configuration generation
 * Demonstrates the nginx configuration generation capabilities
 */

const { NginxConfigGenerator } = require('./packages/cli/src/generators/nginx-config');
const { NginxConfigValidator } = require('./packages/cli/src/validators/nginx-validator');
const chalk = require('chalk');

async function demonstrateNginxConfig() {
  console.log(chalk.blue.bold('🌐 nginx Configuration Generation Demo'));
  console.log(chalk.blue.bold('=====================================\n'));

  try {
    // Create generator with demo configuration
    const generator = new NginxConfigGenerator({
      nginxConfigDir: './demo-output/nginx',
      sitesAvailableDir: './demo-output/nginx/sites-available',
      sitesEnabledDir: './demo-output/nginx/sites-enabled',
      confDir: './demo-output/nginx/conf.d'
    });

    // Demo site configurations
    const demoSites = [
      {
        siteId: 'example-com',
        siteName: 'Example Website',
        domain: 'example.com',
        logPath: '/var/log/nginx/example.com.access.log',
        documentRoot: '/var/www/example.com/html'
      },
      {
        siteId: 'blog-example',
        siteName: 'Example Blog',
        domain: 'blog.example.com',
        logPath: '/var/log/nginx/blog.example.com.access.log',
        documentRoot: '/var/www/blog.example.com/html'
      }
    ];

    console.log(chalk.yellow('📋 1. Generating Analytics Log Format Configuration\n'));
    
    // Generate log format
    const logFormat = generator.generateLogFormat();
    console.log(chalk.gray('Generated log format:'));
    console.log(chalk.white(logFormat));
    console.log();

    console.log(chalk.yellow('📋 2. Generating Site Configurations\n'));
    
    // Generate site configurations
    for (const site of demoSites) {
      console.log(chalk.cyan(`Generating configuration for ${site.domain}:`));
      
      const siteConfig = generator.generateSiteConfig(site);
      console.log(chalk.gray(`✅ Configuration generated (${siteConfig.length} characters)`));
      
      // Show first few lines
      const lines = siteConfig.split('\n').slice(0, 10);
      console.log(chalk.gray('Preview:'));
      lines.forEach(line => console.log(chalk.gray(`  ${line}`)));
      console.log(chalk.gray('  ...'));
      console.log();
    }

    console.log(chalk.yellow('📋 3. Configuration Validation Demo\n'));
    
    // Create validator (will use demo paths)
    const validator = new NginxConfigValidator({
      nginxConfigPath: './demo-output/nginx/nginx.conf',
      sitesAvailableDir: './demo-output/nginx/sites-available',
      sitesEnabledDir: './demo-output/nginx/sites-enabled',
      confDir: './demo-output/nginx/conf.d'
    });

    // Demonstrate validation features
    console.log(chalk.cyan('Checking analytics log format...'));
    const hasLogFormat = await validator.checkAnalyticsLogFormat();
    console.log(hasLogFormat ? 
      chalk.green('✅ Analytics log format found') : 
      chalk.yellow('⚠️  Analytics log format not found (expected in demo)')
    );

    console.log(chalk.cyan('Checking sites with analytics logging...'));
    const sitesWithAnalytics = await validator.checkSitesAnalyticsLogging();
    console.log(`Found ${sitesWithAnalytics.length} sites with analytics logging`);

    console.log(chalk.yellow('\n📋 4. Setup Instructions\n'));
    
    // Show setup instructions
    const instructions = generator.getSetupInstructions();
    console.log(instructions);

    console.log(chalk.yellow('📋 5. CLI Command Examples\n'));
    
    // Show CLI usage examples
    console.log(chalk.cyan('Generate log format:'));
    console.log(chalk.white('  analytics-system nginx log-format'));
    console.log();
    
    console.log(chalk.cyan('Generate site configuration interactively:'));
    console.log(chalk.white('  analytics-system nginx site-config --interactive'));
    console.log();
    
    console.log(chalk.cyan('Generate site configuration with parameters:'));
    console.log(chalk.white('  analytics-system nginx site-config --domain example.com --site-id example-com'));
    console.log();
    
    console.log(chalk.cyan('Validate nginx configuration:'));
    console.log(chalk.white('  analytics-system nginx validate'));
    console.log();
    
    console.log(chalk.cyan('Test and reload nginx:'));
    console.log(chalk.white('  analytics-system nginx test --reload'));
    console.log();

    console.log(chalk.green.bold('🎉 nginx Configuration Demo Complete!'));
    console.log(chalk.green('   - Log format generation ✅'));
    console.log(chalk.green('   - Site configuration generation ✅'));
    console.log(chalk.green('   - Configuration validation ✅'));
    console.log(chalk.green('   - CLI integration ✅'));
    
  } catch (error) {
    console.error(chalk.red('❌ Demo failed:'), error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  demonstrateNginxConfig();
}

module.exports = { demonstrateNginxConfig };