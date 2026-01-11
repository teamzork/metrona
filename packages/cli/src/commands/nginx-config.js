/**
 * @fileoverview nginx configuration management commands
 * Provides CLI commands for generating and managing nginx configurations
 */

const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { NginxConfigGenerator } = require('../generators/nginx-config');
const { NginxConfigValidator } = require('../validators/nginx-validator');

/**
 * Create nginx configuration management command
 * @returns {Command} Commander command
 */
function createNginxCommand() {
  const command = new Command('nginx');
  command.description('nginx configuration management');

  // Generate log format command
  command
    .command('log-format')
    .description('Generate analytics log format configuration')
    .option('--output <path>', 'Output file path')
    .option('--dry-run', 'Show configuration without writing files')
    .action(async (options) => {
      try {
        const generator = new NginxConfigGenerator();
        
        if (options.dryRun) {
          console.log(chalk.blue('📋 Analytics Log Format Configuration:\n'));
          console.log(generator.generateLogFormat());
          return;
        }
        
        const configPath = await generator.writeLogFormatConfig();
        console.log(chalk.green(`✅ Log format configuration generated: ${configPath}`));
        
      } catch (error) {
        console.error(chalk.red('❌ Failed to generate log format:'), error.message);
        process.exit(1);
      }
    });

  // Generate site configuration command
  command
    .command('site-config')
    .description('Generate site-specific nginx configuration')
    .option('--interactive', 'Interactive site configuration')
    .option('--domain <domain>', 'Site domain')
    .option('--site-id <id>', 'Site identifier')
    .option('--log-path <path>', 'Log file path')
    .option('--document-root <path>', 'Document root path')
    .option('--dry-run', 'Show configuration without writing files')
    .action(async (options) => {
      try {
        let siteConfig;
        
        if (options.interactive) {
          siteConfig = await collectSiteConfig();
        } else {
          if (!options.domain || !options.siteId) {
            console.error(chalk.red('❌ --domain and --site-id are required (or use --interactive)'));
            process.exit(1);
          }
          
          siteConfig = {
            domain: options.domain,
            siteId: options.siteId,
            logPath: options.logPath || `/var/log/nginx/${options.domain}.access.log`,
            documentRoot: options.documentRoot || `/var/www/${options.domain}/html`
          };
        }
        
        const generator = new NginxConfigGenerator();
        
        if (options.dryRun) {
          console.log(chalk.blue(`📋 nginx Configuration for ${siteConfig.domain}:\n`));
          console.log(generator.generateSiteConfig(siteConfig));
          return;
        }
        
        const result = await generator.generateCompleteConfig(siteConfig);
        console.log(chalk.green(`✅ Site configuration generated: ${result.siteConfigPath}`));
        
      } catch (error) {
        console.error(chalk.red('❌ Failed to generate site configuration:'), error.message);
        process.exit(1);
      }
    });

  // Validate configuration command
  command
    .command('validate')
    .description('Validate nginx configuration')
    .option('--config-path <path>', 'Path to nginx configuration file')
    .option('--check-syntax', 'Check syntax only')
    .option('--check-analytics', 'Check analytics log format configuration')
    .action(async (options) => {
      try {
        const validator = new NginxConfigValidator();
        
        console.log(chalk.blue('🔍 Validating nginx configuration...\n'));
        
        // Basic syntax validation
        if (!options.checkAnalytics) {
          const syntaxValid = await validator.validateSyntax();
          if (syntaxValid) {
            console.log(chalk.green('✅ nginx syntax validation passed'));
          } else {
            console.log(chalk.red('❌ nginx syntax validation failed'));
            process.exit(1);
          }
        }
        
        // Analytics-specific validation
        if (options.checkAnalytics || !options.checkSyntax) {
          const analyticsValid = await validator.validateAnalyticsConfiguration();
          if (analyticsValid) {
            console.log(chalk.green('✅ Analytics configuration validation passed'));
          } else {
            console.log(chalk.yellow('⚠️  Analytics configuration issues found'));
          }
        }
        
      } catch (error) {
        console.error(chalk.red('❌ Validation failed:'), error.message);
        process.exit(1);
      }
    });

  // Test configuration command
  command
    .command('test')
    .description('Test nginx configuration and reload if valid')
    .option('--reload', 'Reload nginx if configuration is valid')
    .action(async (options) => {
      try {
        const validator = new NginxConfigValidator();
        
        console.log(chalk.blue('🧪 Testing nginx configuration...\n'));
        
        const isValid = await validator.validateSyntax();
        
        if (isValid) {
          console.log(chalk.green('✅ Configuration test passed'));
          
          if (options.reload) {
            console.log(chalk.blue('🔄 Reloading nginx...'));
            const reloaded = await validator.reloadNginx();
            
            if (reloaded) {
              console.log(chalk.green('✅ nginx reloaded successfully'));
            } else {
              console.log(chalk.red('❌ nginx reload failed'));
              process.exit(1);
            }
          }
        } else {
          console.log(chalk.red('❌ Configuration test failed'));
          process.exit(1);
        }
        
      } catch (error) {
        console.error(chalk.red('❌ Test failed:'), error.message);
        process.exit(1);
      }
    });

  // Show setup instructions
  command
    .command('instructions')
    .description('Show nginx setup instructions')
    .action(() => {
      const generator = new NginxConfigGenerator();
      console.log(generator.getSetupInstructions());
    });

  return command;
}

/**
 * Collect site configuration interactively
 * @returns {Promise<Object>} Site configuration
 */
async function collectSiteConfig() {
  console.log(chalk.yellow('🌐 Interactive Site Configuration\n'));
  
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'domain',
      message: 'Domain name (e.g., example.com):',
      validate: (input) => {
        if (!input.trim()) return 'Domain is required';
        if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/.test(input)) {
          return 'Please enter a valid domain name';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'siteId',
      message: 'Site ID (unique identifier):',
      default: (answers) => answers.domain.replace(/\./g, '-'),
      validate: (input) => {
        if (!input.trim()) return 'Site ID is required';
        if (!/^[a-z0-9-]+$/.test(input)) return 'Site ID must contain only lowercase letters, numbers, and hyphens';
        return true;
      }
    },
    {
      type: 'input',
      name: 'logPath',
      message: 'Access log file path:',
      default: (answers) => `/var/log/nginx/${answers.domain}.access.log`
    },
    {
      type: 'input',
      name: 'documentRoot',
      message: 'Document root path:',
      default: (answers) => `/var/www/${answers.domain}/html`
    },
    {
      type: 'confirm',
      name: 'enableSSL',
      message: 'Include SSL configuration template?',
      default: true
    }
  ]);

  return answers;
}

module.exports = { createNginxCommand };