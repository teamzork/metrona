#!/usr/bin/env node

/**
 * @fileoverview Main CLI entry point for Metrona Analytics System
 * Provides interactive setup wizard and management commands
 */

const { Command } = require('commander');
const chalk = require('chalk');
const { SetupWizard } = require('./setup/setup-wizard');
const { DependencyChecker } = require('./utils/dependency-checker');
const { createNginxCommand } = require('./commands/nginx-config');
const { version } = require('../package.json');

const program = new Command();

program
  .name('metrona')
  .description('Metrona Analytics System - Privacy-focused web analytics')
  .version(version);

program
  .command('setup')
  .description('Run interactive setup wizard')
  .option('--skip-deps', 'Skip dependency checking')
  .option('--config-path <path>', 'Custom configuration file path')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('\n🚀 Metrona Analytics System Setup\n'));
      
      // Check dependencies unless skipped
      if (!options.skipDeps) {
        console.log(chalk.yellow('📋 Checking system dependencies...\n'));
        const depChecker = new DependencyChecker();
        const depResults = await depChecker.checkAllDependencies();
        
        if (!depResults.allPassed) {
          console.log(chalk.red('❌ Dependency check failed. Please install missing dependencies.\n'));
          process.exit(1);
        }
        
        console.log(chalk.green('✅ All dependencies satisfied\n'));
      }
      
      // Run setup wizard
      const wizard = new SetupWizard({
        configPath: options.configPath
      });
      
      await wizard.run();
      
      console.log(chalk.green.bold('\n🎉 Setup completed successfully!'));
      console.log(chalk.cyan('You can now start the analytics system with:'));
      console.log(chalk.white('  systemctl start metrona-scheduler metrona-dashboard'));
      
    } catch (error) {
      console.error(chalk.red.bold('\n❌ Setup failed:'), error.message);
      if (error.rollback) {
        console.log(chalk.yellow('🔄 Rolling back changes...'));
        await error.rollback();
        console.log(chalk.green('✅ Rollback completed'));
      }
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check system status')
  .action(async () => {
    try {
      const depChecker = new DependencyChecker();
      const results = await depChecker.checkAllDependencies();
      
      console.log(chalk.blue.bold('\n📊 System Status\n'));
      
      results.results.forEach(result => {
        const status = result.satisfied ? 
          chalk.green('✅') : 
          chalk.red('❌');
        console.log(`${status} ${result.name}: ${result.message}`);
      });
      
      console.log(`\n${results.allPassed ? 
        chalk.green('🟢 System Ready') : 
        chalk.red('🔴 Issues Found')}`);
        
    } catch (error) {
      console.error(chalk.red('❌ Status check failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Configuration management')
  .option('--validate', 'Validate configuration file')
  .option('--path <path>', 'Configuration file path')
  .action(async (options) => {
    try {
      // Configuration management will be implemented in later tasks
      console.log(chalk.yellow('⚠️  Configuration management coming in future version'));
    } catch (error) {
      console.error(chalk.red('❌ Configuration command failed:'), error.message);
      process.exit(1);
    }
  });

// Add nginx configuration management
program.addCommand(createNginxCommand());

// Handle unknown commands
program.on('command:*', () => {
  console.error(chalk.red(`❌ Unknown command: ${program.args.join(' ')}`));
  console.log(chalk.cyan('Run --help to see available commands'));
  process.exit(1);
});

// Parse command line arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}