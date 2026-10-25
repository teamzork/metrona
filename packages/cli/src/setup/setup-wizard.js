/**
 * @fileoverview Interactive setup wizard for Metrona Analytics System
 * Guides users through initial configuration and system setup
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const bcrypt = require('bcryptjs');
const { NginxConfigGenerator } = require('../generators/nginx-config');
const { SystemdServiceGenerator } = require('../generators/systemd-service');

class SetupWizard {
  constructor(options = {}) {
    this.configPath = options.configPath || '/etc/metrona/metrona.yaml';
    this.backupPath = null;
    this.rollbackActions = [];
  }

  /**
   * Run the complete setup wizard
   */
  async run() {
    console.log(chalk.blue('Welcome to the Metrona Analytics System setup wizard!'));
    console.log(chalk.gray('This wizard will guide you through the initial configuration.\n'));

    try {
      // Step 1: Basic system configuration
      const systemConfig = await this.collectSystemConfiguration();
      
      // Step 2: Site configuration
      const sites = await this.collectSiteConfiguration();
      
      // Step 3: Authentication setup
      const authConfig = await this.collectAuthenticationConfiguration();
      
      // Step 4: Generate configuration
      const config = this.buildConfiguration(systemConfig, sites, authConfig);
      
      // Step 5: Save configuration
      await this.saveConfiguration(config);
      
      // Step 6: Generate nginx configuration
      await this.generateNginxConfiguration(sites);
      
      // Step 7: Generate systemd service
      await this.generateSystemdService(systemConfig);
      
      console.log(chalk.green('\n✅ Setup wizard completed successfully!'));
      
    } catch (error) {
      console.error(chalk.red('\n❌ Setup wizard failed:'), error.message);
      await this.rollback();
      throw error;
    }
  }

  /**
   * Collect basic system configuration
   */
  async collectSystemConfiguration() {
    console.log(chalk.yellow('📋 System Configuration\n'));
    
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'outputDir',
        message: 'Where should analytics data be stored?',
        default: '/var/lib/metrona/datasets',
        validate: (input) => {
          if (!input.trim()) return 'Output directory is required';
          if (!path.isAbsolute(input)) return 'Please provide an absolute path';
          return true;
        }
      },
      {
        type: 'list',
        name: 'timezone',
        message: 'Select your timezone:',
        choices: [
          'UTC',
          'America/New_York',
          'America/Los_Angeles',
          'Europe/London',
          'Europe/Paris',
          'Asia/Tokyo',
          'Australia/Sydney'
        ],
        default: 'UTC'
      },
      {
        type: 'list',
        name: 'logLevel',
        message: 'Select log level:',
        choices: [
          { name: 'Error (minimal logging)', value: 'error' },
          { name: 'Warn (recommended)', value: 'warn' },
          { name: 'Info (verbose)', value: 'info' },
          { name: 'Debug (development)', value: 'debug' }
        ],
        default: 'warn'
      }
    ]);

    return answers;
  }

  /**
   * Collect site configuration
   */
  async collectSiteConfiguration() {
    console.log(chalk.yellow('\n🌐 Website Configuration\n'));
    
    const sites = [];
    let addMore = true;

    while (addMore) {
      const siteAnswers = await inquirer.prompt([
        {
          type: 'input',
          name: 'siteId',
          message: 'Site ID (unique identifier):',
          validate: (input) => {
            if (!input.trim()) return 'Site ID is required';
            if (!/^[a-z0-9-]+$/.test(input)) return 'Site ID must contain only lowercase letters, numbers, and hyphens';
            if (sites.some(site => site.siteId === input)) return 'Site ID must be unique';
            return true;
          }
        },
        {
          type: 'input',
          name: 'siteName',
          message: 'Site name (display name):',
          validate: (input) => input.trim() ? true : 'Site name is required'
        },
        {
          type: 'input',
          name: 'domain',
          message: 'Domain name (e.g., example.com):',
          validate: (input) => {
            if (!input.trim()) return 'Domain is required';
            // Basic domain validation
            if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/.test(input)) {
              return 'Please enter a valid domain name';
            }
            return true;
          }
        },
        {
          type: 'input',
          name: 'logPath',
          message: 'Nginx access log path:',
          default: (answers) => `/var/log/nginx/${answers.domain}.access.log`,
          validate: (input) => {
            if (!input.trim()) return 'Log path is required';
            if (!path.isAbsolute(input)) return 'Please provide an absolute path';
            return true;
          }
        },
        {
          type: 'list',
          name: 'schedule',
          message: 'Analytics generation schedule:',
          choices: [
            { name: 'Hourly (recommended for active sites)', value: 'hourly' },
            { name: 'Daily (recommended for most sites)', value: 'daily' },
            { name: 'Custom cron expression', value: 'custom' }
          ],
          default: 'daily'
        }
      ]);

      // Handle custom cron expression
      if (siteAnswers.schedule === 'custom') {
        const cronAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'cronExpression',
            message: 'Enter cron expression (e.g., "0 */6 * * *" for every 6 hours):',
            validate: (input) => {
              if (!input.trim()) return 'Cron expression is required';
              // Basic cron validation (5 parts)
              const parts = input.trim().split(/\s+/);
              if (parts.length !== 5) return 'Cron expression must have 5 parts (minute hour day month weekday)';
              return true;
            }
          }
        ]);
        siteAnswers.schedule = cronAnswer.cronExpression;
      }

      sites.push({
        ...siteAnswers,
        enabled: true,
        timezone: 'UTC' // Will inherit from system config
      });

      // Ask if user wants to add more sites
      const continueAnswer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'addAnother',
          message: 'Add another website?',
          default: false
        }
      ]);

      addMore = continueAnswer.addAnother;
    }

    return sites;
  }

  /**
   * Collect authentication configuration
   */
  async collectAuthenticationConfiguration() {
    console.log(chalk.yellow('\n🔐 Authentication Configuration\n'));
    
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableAuth',
        message: 'Enable dashboard authentication?',
        default: true
      }
    ]);

    if (!answers.enableAuth) {
      return { enabled: false };
    }

    const authAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'username',
        message: 'Dashboard username:',
        default: 'admin',
        validate: (input) => {
          if (!input.trim()) return 'Username is required';
          if (input.length < 3) return 'Username must be at least 3 characters';
          return true;
        }
      },
      {
        type: 'password',
        name: 'password',
        message: 'Dashboard password:',
        mask: '*',
        validate: (input) => {
          if (!input) return 'Password is required';
          if (input.length < 8) return 'Password must be at least 8 characters';
          return true;
        }
      },
      {
        type: 'password',
        name: 'confirmPassword',
        message: 'Confirm password:',
        mask: '*',
        validate: (input, answers) => {
          if (input !== answers.password) return 'Passwords do not match';
          return true;
        }
      }
    ]);

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(authAnswers.password, saltRounds);

    return {
      enabled: true,
      username: authAnswers.username,
      passwordHash: hashedPassword
    };
  }

  /**
   * Build complete configuration object
   */
  buildConfiguration(systemConfig, sites, authConfig) {
    return {
      version: '1.0',
      scheduler: {
        timezone: systemConfig.timezone,
        outputDir: systemConfig.outputDir,
        logLevel: systemConfig.logLevel
      },
      sites: sites,
      authentication: authConfig,
      jobs: {
        cleanup: {
          schedule: 'daily',
          enabled: true,
          options: {
            maxAge: 30 // Keep data for 30 days
          }
        }
      }
    };
  }

  /**
   * Save configuration to file
   */
  async saveConfiguration(config) {
    console.log(chalk.yellow('\n💾 Saving configuration...\n'));
    
    try {
      // Create backup if file exists
      try {
        await fs.access(this.configPath);
        this.backupPath = `${this.configPath}.backup.${Date.now()}`;
        await fs.copyFile(this.configPath, this.backupPath);
        this.rollbackActions.push(() => fs.copyFile(this.backupPath, this.configPath));
        console.log(chalk.gray(`📋 Created backup: ${this.backupPath}`));
      } catch (error) {
        // File doesn't exist, no backup needed
      }

      // Ensure directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      this.rollbackActions.push(() => fs.rmdir(configDir, { recursive: true }));

      // Write configuration
      const yamlContent = yaml.dump(config, {
        indent: 2,
        lineWidth: 120,
        noRefs: true
      });

      await fs.writeFile(this.configPath, yamlContent, 'utf8');
      await fs.chmod(this.configPath, 0o600); // Secure permissions
      
      console.log(chalk.green(`✅ Configuration saved to: ${this.configPath}`));
      
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error.message}`);
    }
  }

  /**
   * Generate nginx configuration
   */
  async generateNginxConfiguration(sites) {
    console.log(chalk.yellow('\n🌐 Generating nginx configuration...\n'));
    
    try {
      const generator = new NginxConfigGenerator();
      
      for (const site of sites) {
        await generator.generateCompleteConfig(site);
        console.log(chalk.green(`✅ Generated nginx config for ${site.domain}`));
      }
      
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Nginx configuration generation failed: ${error.message}`));
      console.log(chalk.gray('You can generate nginx configs manually later'));
    }
  }

  /**
   * Generate systemd service
   */
  async generateSystemdService(systemConfig) {
    console.log(chalk.yellow('\n⚙️  Generating systemd service...\n'));
    
    try {
      const generator = new SystemdServiceGenerator();
      await generator.generateService({
        configPath: this.configPath,
        outputDir: systemConfig.outputDir
      });
      
      console.log(chalk.green('✅ Generated systemd service file'));
      
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Systemd service generation failed: ${error.message}`));
      console.log(chalk.gray('You can create the service file manually later'));
    }
  }

  /**
   * Rollback changes on failure
   */
  async rollback() {
    if (this.rollbackActions.length === 0) return;
    
    console.log(chalk.yellow('\n🔄 Rolling back changes...\n'));
    
    for (const action of this.rollbackActions.reverse()) {
      try {
        await action();
      } catch (error) {
        console.log(chalk.red(`⚠️  Rollback action failed: ${error.message}`));
      }
    }
    
    console.log(chalk.green('✅ Rollback completed'));
  }
}

module.exports = { SetupWizard };