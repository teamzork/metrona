/**
 * @fileoverview `metrona scheduler` and `metrona dashboard`: the two long-running services, as the
 * systemd units and the Docker image start them.
 */

const fs = require('fs');
const path = require('path');
const { DEFAULTS, configPath } = require('./common');

/** The hourly job. Options are the scheduler daemon's own (see `metrona scheduler --help`). */
async function scheduler(args) {
  const daemon = require('@metrona/scheduler/src/daemon');
  const withDefaults = [...args];
  if (!args.some((a) => a === '-c' || a === '--config')) withDefaults.push('--config', configPath());
  if (!args.some((a) => a === '-o' || a === '--output')) withDefaults.push('--output', DEFAULTS.datasets);
  if (!args.includes('--dashboard-data')) withDefaults.push('--dashboard-data', DEFAULTS.dashboardData);
  // Make the output folders, so a fresh volume or container needs nothing done first.
  for (const flag of ['--output', '-o', '--dashboard-data']) {
    const at = withDefaults.indexOf(flag);
    if (at > -1 && withDefaults[at + 1]) fs.mkdirSync(withDefaults[at + 1], { recursive: true });
  }
  process.argv = [process.argv[0], 'metrona-scheduler', ...withDefaults];
  await daemon.main();
}

/** The dashboard, configured by the `dashboard:` section of metrona.yaml. */
async function dashboard(options) {
  const { loadConfig, dashboardOptions } = require('@metrona/dashboard/src/start');
  const { ServerDashboard } = require('@metrona/dashboard');
  const config = loadConfig(path.resolve(configPath(options.config)));
  const server = new ServerDashboard(dashboardOptions(config));
  await server.start();
  const stop = () => server.stop().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { scheduler, dashboard };
