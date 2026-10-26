/**
 * @fileoverview `metrona run`: process every site once, now, and exit. The scheduler does the
 * same every hour; this is for a first run, a check after a config change, or cron instead of a
 * daemon. It needs the same VISITOR_HASH_SALT the scheduler uses, or visitors won't match.
 */

const fs = require('fs');
const { DEFAULTS, configPath, loadConfig, dashboardDataDir, publishDir, loadEnvFile, enabledSites } = require('./common');

/** Holds console output back until restore(). */
function silence() {
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(saved)) console[k] = () => {};
  return { restore: () => Object.assign(console, saved) };
}

async function run(options) {
  const file = configPath(options.config);
  const config = loadConfig(file);
  const envFile = options.secretsFile || DEFAULTS.envFile;
  loadEnvFile(envFile);
  const salt = process.env.VISITOR_HASH_SALT;
  if (!salt) {
    throw new Error(`VISITOR_HASH_SALT is not set, in the environment or in ${envFile}. It must be the scheduler's own salt, or visitors won't match its counts.`);
  }

  const outputDir = options.output || DEFAULTS.datasets;
  const dashboardData = dashboardDataDir(config, options.dashboardData);
  fs.mkdirSync(outputDir, { recursive: true });

  const { JobExecutor } = require('@metrona/scheduler');
  const publish = publishDir(config, options.publishDir);
  const executor = new JobExecutor({ outputDir, dashboardDataDir: dashboardData, salt, publishDir: publish });
  let failed = 0;
  for (const site of enabledSites(config, options.site)) {
    // The executor logs every step for the daemon's journal; here one line per site is enough.
    const quiet = options.verbose ? null : silence();
    try {
      const result = await executor.createSiteProcessingJob(site)();
      quiet?.restore();
      const a = result.analytics || {};
      console.log(`✓ ${site.siteId}: ${a.totalPageviews ?? 0} pageviews, ${a.uniqueVisitors ?? 0} visitors (${result.duration ?? '?'} ms)`);
    } catch (error) {
      quiet?.restore();
      failed++;
      const reason = error.originalError ? error.originalError.message : error.message;
      console.error(`✗ ${site.siteId}: ${reason}`);
    }
  }
  console.log(`\nWrote ${dashboardData}${publish ? ` and the pages in ${publish}` : ''}`);
  if (process.getuid && process.getuid() === 0) {
    console.log('Ran as root: if the services run as the metrona user, prefer `sudo -u metrona metrona run` so they can keep writing these files.');
  }
  return failed;
}

module.exports = { run };
