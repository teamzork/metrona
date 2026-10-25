#!/usr/bin/env node

/**
 * @fileoverview CLI daemon script for the scheduler
 * Feature: metrona-analytics-system, Requirements 2.1, 2.2, 2.6
 */

const { SchedulerDaemon } = require('./scheduler-daemon');
const path = require('path');

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    configPath: './config/scheduler.yaml',
    outputDir: './analytics',
    dashboardDataDir: null,
    timezone: 'UTC',
    logLevel: 'info',
    daemon: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--dashboard-data':
        options.dashboardDataDir = args[++i];
        break;
        
      case '--config':
      case '-c':
        options.configPath = args[++i];
        break;
      case '--output':
      case '-o':
        options.outputDir = args[++i];
        break;
      case '--timezone':
      case '-t':
        options.timezone = args[++i];
        break;
      case '--log-level':
      case '-l':
        options.logLevel = args[++i];
        break;
      case '--daemon':
      case '-d':
        options.daemon = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      case '--version':
      case '-v':
        printVersion();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }
  
  return options;
}

/**
 * Print help information
 */
function printHelp() {
  console.log(`
Metrona Analytics Scheduler Daemon

Usage: metrona-scheduler [options]

Options:
  -c, --config <path>     Configuration file path (default: ./config/scheduler.yaml)
  -o, --output <dir>      Output directory for analytics data (default: ./analytics)
      --dashboard-data <dir>
                          Where to write <siteId>.yaml for the dashboard (default: the output directory)
  -t, --timezone <tz>     Default timezone (default: UTC)
  -l, --log-level <level> Log level: error, warn, info, debug (default: info)
  -d, --daemon            Run as daemon (detach from terminal)
  -h, --help              Show this help message
  -v, --version           Show version information

Examples:
  metrona-scheduler                                    # Run with default settings
  metrona-scheduler -c /etc/metrona/scheduler.yaml    # Use custom config
  metrona-scheduler -o /var/lib/metrona/analytics     # Custom output directory
  metrona-scheduler -d                                # Run as daemon

Signals:
  SIGTERM, SIGINT         Graceful shutdown
  SIGHUP                  Reload configuration
  SIGUSR1                 Print status information
`);
}

/**
 * Print version information
 */
function printVersion() {
  const packageJson = require('../package.json');
  console.log(`Metrona Analytics Scheduler v${packageJson.version}`);
}

/**
 * Setup logging based on log level
 * @param {string} logLevel - Log level
 */
function setupLogging(logLevel) {
  const levels = ['error', 'warn', 'info', 'debug'];
  const levelIndex = levels.indexOf(logLevel.toLowerCase());
  
  if (levelIndex === -1) {
    console.error(`Invalid log level: ${logLevel}`);
    process.exit(1);
  }
  
  // Simple logging setup - in production you might want to use a proper logger
  global.logLevel = levelIndex;
  
  global.log = {
    error: (...args) => levelIndex >= 0 && console.error('[ERROR]', new Date().toISOString(), ...args),
    warn: (...args) => levelIndex >= 1 && console.warn('[WARN]', new Date().toISOString(), ...args),
    info: (...args) => levelIndex >= 2 && console.log('[INFO]', new Date().toISOString(), ...args),
    debug: (...args) => levelIndex >= 3 && console.log('[DEBUG]', new Date().toISOString(), ...args)
  };
}

/**
 * Setup signal handlers for graceful shutdown and control
 * @param {SchedulerDaemon} daemon - Scheduler daemon instance
 */
function setupSignalHandlers(daemon) {
  let shutdownInProgress = false;
  
  // Graceful shutdown on SIGTERM and SIGINT
  const gracefulShutdown = async (signal) => {
    if (shutdownInProgress) {
      global.log.warn(`Received ${signal} during shutdown, forcing exit`);
      process.exit(1);
    }
    
    shutdownInProgress = true;
    global.log.info(`Received ${signal}, starting graceful shutdown...`);
    
    try {
      await daemon.stop(30000); // 30 second timeout
      global.log.info('Scheduler daemon stopped gracefully');
      process.exit(0);
    } catch (error) {
      global.log.error('Error during shutdown:', error.message);
      process.exit(1);
    }
  };
  
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  // Reload configuration on SIGHUP
  process.on('SIGHUP', async () => {
    global.log.info('Received SIGHUP, reloading configuration...');
    try {
      await daemon.reloadConfiguration();
      global.log.info('Configuration reloaded successfully');
    } catch (error) {
      global.log.error('Error reloading configuration:', error.message);
    }
  });
  
  // Print status on SIGUSR1
  process.on('SIGUSR1', () => {
    global.log.info('Received SIGUSR1, printing status...');
    const status = daemon.getStatus();
    console.log(JSON.stringify(status, null, 2));
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    global.log.error('Uncaught exception:', error);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    global.log.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}

/**
 * Setup daemon event handlers
 * @param {SchedulerDaemon} daemon - Scheduler daemon instance
 */
function setupDaemonEventHandlers(daemon) {
  daemon.on('starting', () => {
    global.log.info('Starting scheduler daemon...');
  });
  
  daemon.on('started', () => {
    global.log.info('Scheduler daemon started successfully');
  });
  
  daemon.on('stopping', () => {
    global.log.info('Stopping scheduler daemon...');
  });
  
  daemon.on('stopped', () => {
    global.log.info('Scheduler daemon stopped');
  });
  
  daemon.on('configLoaded', (data) => {
    global.log.info(`Configuration loaded from: ${data.configPath}`);
  });
  
  daemon.on('defaultConfigCreated', (data) => {
    global.log.info(`Default configuration created at: ${data.configPath}`);
  });
  
  daemon.on('configReloaded', () => {
    global.log.info('Configuration reloaded successfully');
  });
  
  daemon.on('jobScheduled', (data) => {
    global.log.info(`Job scheduled: ${data.jobId} (${data.schedule})`);
  });
  
  daemon.on('jobStarted', (data) => {
    global.log.info(`Job started: ${data.jobId}`);
  });
  
  daemon.on('jobCompleted', (data) => {
    if (data.success) {
      global.log.info(`Job completed: ${data.jobId} (${data.duration}ms)`);
    } else {
      global.log.error(`Job failed: ${data.jobId} - ${data.error}`);
    }
  });
  
  daemon.on('error', (data) => {
    global.log.error(`Daemon error (${data.type}):`, data.error);
  });
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse command line arguments
    const options = parseArgs();
    
    // Setup logging
    setupLogging(options.logLevel);
    
    global.log.info('Metrona Analytics Scheduler starting...');
    global.log.debug('Options:', options);
    
    // Create scheduler daemon
    const daemon = new SchedulerDaemon({
      configPath: path.resolve(options.configPath),
      outputDir: path.resolve(options.outputDir),
      timezone: options.timezone,
      executorOptions: options.dashboardDataDir ? { dashboardDataDir: path.resolve(options.dashboardDataDir) } : {}
    });
    
    // Setup event handlers
    setupDaemonEventHandlers(daemon);
    setupSignalHandlers(daemon);
    
    // Start the daemon
    await daemon.start();
    
    // If running as daemon, detach from terminal
    if (options.daemon) {
      global.log.info('Running as daemon, detaching from terminal...');
      process.stdin.pause();
    } else {
      global.log.info('Scheduler daemon is running. Press Ctrl+C to stop.');
    }
    
    // Keep the process alive
    process.stdin.resume();
    
  } catch (error) {
    console.error('Failed to start scheduler daemon:', error.message);
    process.exit(1);
  }
}

// Run main function if this script is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  setupLogging,
  setupSignalHandlers,
  setupDaemonEventHandlers
};