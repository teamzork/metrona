/**
 * @fileoverview What the `metrona` commands share: default paths, reading metrona.yaml and
 * metrona.env, and short output helpers.
 */

const fs = require('fs');
const yaml = require('js-yaml');

const DEFAULTS = {
  config: '/etc/metrona/metrona.yaml',
  envFile: '/etc/metrona/metrona.env',
  datasets: '/var/lib/metrona/datasets',
  dashboardData: '/var/lib/metrona/dashboard',
};

/** --config, else METRONA_CONFIG, else /etc/metrona/metrona.yaml */
function configPath(option) {
  return option || process.env.METRONA_CONFIG || DEFAULTS.config;
}

/**
 * Reads and checks metrona.yaml: the same site rules the scheduler applies.
 * @returns {{ sites: Object[], dashboard: Object }}
 */
function loadConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`No config at ${file}. Create one with \`sudo metrona init\`, or pass --config.`);
    if (error.code === 'EACCES') throw new Error(`Can't read ${file} (permission denied). Try sudo, or run as the metrona user.`);
    throw error;
  }
  const config = yaml.load(text) || {};
  if (!Array.isArray(config.sites) || config.sites.length === 0) throw new Error(`${file}: no sites configured`);
  const { ConfigurationManager } = require('@metrona/scheduler');
  const checker = new ConfigurationManager({ configPath: file });
  for (const site of config.sites) {
    try {
      checker.validateSiteConfiguration(site);
    } catch (error) {
      throw new Error(`${file}, site ${site.siteId || '(no siteId)'}: ${error.message}`);
    }
  }
  return { ...config, dashboard: config.dashboard || {} };
}

/** Where the scheduler writes <siteId>.yaml for the dashboard (and the MCP server). */
function dashboardDataDir(config, option) {
  return option || process.env.METRONA_DATA_DIR || (config && config.dashboard && config.dashboard.dataDir) || DEFAULTS.dashboardData;
}

/**
 * Loads KEY=VALUE lines into process.env, without overriding what is already set — the same
 * file systemd's EnvironmentFile reads. A missing file is fine; an unreadable one is said.
 */
function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    if (error.code === 'EACCES') throw new Error(`Can't read ${file} (permission denied). Try sudo, or run as the metrona user.`);
    throw error;
  }
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return true;
}

function enabledSites(config, only) {
  const sites = config.sites.filter((s) => s.enabled !== false);
  if (!only) return sites;
  const picked = sites.filter((s) => s.siteId === only || s.domain === only);
  if (picked.length === 0) throw new Error(`No enabled site "${only}". These exist: ${sites.map((s) => s.siteId).join(', ')}`);
  return picked;
}

/** "3 min ago", "2 h ago", "4 d ago" */
function ago(date, now = Date.now()) {
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

module.exports = { DEFAULTS, configPath, loadConfig, dashboardDataDir, loadEnvFile, enabledSites, ago };
