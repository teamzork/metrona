#!/usr/bin/env node

/**
 * @fileoverview The `metrona` command: try it (demo), set it up (init, add-site), run it (scheduler,
 * dashboard, run), check it (status), and ask an agent about it (mcp).
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
  .description('Website analytics from your server logs: no script, no cookies, no database')
  .version(version);

/** Runs an async command; a thrown error is printed plainly and exits 1. */
const action = (fn) => async (...args) => {
  try {
    const code = await fn(...args);
    if (typeof code === 'number' && code > 0) process.exitCode = 1;
  } catch (error) {
    console.error(chalk.red(`✗ ${error.message}`));
    process.exit(1);
  }
};
const collect = (value, list) => [...list, value];

program
  .command('demo')
  .description('Open the dashboard on sample data: nothing to configure')
  .option('-p, --port <port>', 'port to listen on', process.env.PORT || '3003')
  .option('--host <host>', 'address to listen on (0.0.0.0 inside a container)', process.env.METRONA_DEMO_HOST || '127.0.0.1')
  .action(action((opts) => require('./commands/demo').demo(opts)));

program
  .command('init')
  .description('Set Metrona up on this server: config, secrets, systemd units, user and folders')
  .option('--server <nginx|caddy>', 'the web server writing the access logs')
  .option('--site <domain=logPath>', 'a site and its access log (repeat for more)', collect, [])
  .option('--cloudflare', "the sites are behind Cloudflare's proxy")
  .option('--stats', 'also show the numbers on each site at /stats/, behind a password')
  .option('--no-stats', "don't ask about /stats/")
  .option('--new-password', 'with --stats: replace the /stats/ password')
  .option('--port <port>', 'dashboard port on 127.0.0.1', '3001')
  .option('--start', 'enable and start both services when done')
  .option('-y, --yes', "don't ask: take everything from the options")
  .option('--force', 'replace an existing metrona.yaml (the salt is always kept)')
  .option('--root <dir>', "write under <dir> instead of /, and don't touch the system")
  .action(action(async (opts) => {
    const init = require('./commands/init');
    init.printNextSteps(await init.init(opts));
  }));

program
  .command('add-site')
  .description('Add a site to this Metrona, keeping the sites already set up')
  .argument('<domain=logPath>', 'the site and its access log, e.g. example.com=/var/log/nginx/example.com-access.log')
  .option('--server <nginx|caddy>', 'the web server writing the log (default: the one the other sites use)')
  .option('--cloudflare', "the site is behind Cloudflare's proxy")
  .option('--stats', 'show its numbers at /stats/ on the site, behind the password (default when other sites do)')
  .option('--no-stats', 'no /stats/ page for this site')
  .option('-c, --config <file>', 'metrona.yaml (default /etc/metrona/metrona.yaml, or METRONA_CONFIG)')
  .option('--no-restart', "don't restart the running Metrona services")
  .option('--root <dir>', "change files under <dir> instead of /, and don't touch the system")
  .action(action(async (site, opts) => {
    const addSite = require('./commands/add-site');
    addSite.printNextSteps(await addSite.addSite({ ...opts, site }));
  }));

program
  .command('run')
  .description('Process every site once, now, and exit (the scheduler does this hourly)')
  .option('-c, --config <file>', 'metrona.yaml (default /etc/metrona/metrona.yaml, or METRONA_CONFIG)')
  .option('--secrets-file <file>', 'where VISITOR_HASH_SALT is (default /etc/metrona/metrona.env)')
  .option('-o, --output <dir>', 'datasets folder (default /var/lib/metrona/datasets)')
  .option('--dashboard-data <dir>', "where to write each site's numbers (default: the config's dashboard.dataDir)")
  .option('--site <siteId>', 'only this site')
  .option('--publish-dir <dir>', "also write each site's static page here (default: the config's publish.dir)")
  .option('--verbose', "show the processing log, not just each site's result")
  .action(action((opts) => require('./commands/run').run(opts)));

program
  .command('publish')
  .description("Write each site's page as static files now, for the web server to serve at /stats/")
  .option('-c, --config <file>', 'metrona.yaml (default /etc/metrona/metrona.yaml, or METRONA_CONFIG)')
  .option('--dir <dir>', "where to write (default: the config's publish.dir)")
  .option('--dashboard-data <dir>', "where each site's numbers are (default: the config's dashboard.dataDir)")
  .option('--site <siteId>', 'only this site')
  .action(action((opts) => require('./commands/publish').publish(opts)));

program
  .command('status')
  .description("Each site's log and when its numbers were last written")
  .option('-c, --config <file>', 'metrona.yaml (default /etc/metrona/metrona.yaml, or METRONA_CONFIG)')
  .option('--dashboard-data <dir>', "where each site's numbers are (default: the config's dashboard.dataDir)")
  .option('--json', 'machine-readable output')
  .action(action((opts) => require('./commands/status').status(opts)));

program
  .command('scheduler')
  .description('Run the hourly scheduler (what the metrona-scheduler service starts)')
  .allowUnknownOption()
  .helpOption(false)
  .argument('[options...]', 'scheduler options, see `metrona scheduler --help`')
  .action(action((args) => require('./commands/services').scheduler(args)));

program
  .command('dashboard')
  .description('Run the dashboard (what the metrona-dashboard service starts)')
  .option('-c, --config <file>', 'metrona.yaml (default /etc/metrona/metrona.yaml, or METRONA_CONFIG)')
  .action(action((opts) => require('./commands/services').dashboard(opts)));

program
  .command('mcp')
  .description('Serve the read-only MCP server over stdio, for Claude Code, Cursor and other agents')
  .option('--data-dir <dir>', "where each site's numbers are (default: METRONA_DATA_DIR, the config's dashboard.dataDir, /var/lib/metrona/dashboard)")
  .option('-c, --config <file>', 'metrona.yaml to read dashboard.dataDir from')
  .action(action((opts) => require('./commands/mcp').mcp(opts)));

program
  .command('setup')
  .description('The earlier interactive nginx wizard (superseded by init)')
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
  .command('doctor')
  .description('Check this machine: Node, the web server, systemd')
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