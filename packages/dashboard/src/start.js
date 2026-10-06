#!/usr/bin/env node
/**
 * @fileoverview Starts the server dashboard from the same YAML file the scheduler reads.
 *
 *   node packages/dashboard/src/start.js /etc/metrona/metrona.yaml
 *
 * Uses `sites` (siteId, siteName, domain) and an optional `dashboard` section:
 *
 *   dashboard:
 *     host: 127.0.0.1          # keep loopback; a reverse proxy serves it
 *     port: 3001
 *     dataDir: /var/lib/metrona/dashboard   # where the scheduler writes <siteId>.yaml
 *     passwordHash: ""         # bcrypt hash; empty = no login (protect it at the proxy instead)
 *     httpsOnly: true          # expects X-Forwarded-Proto: https from the proxy
 *     frameAncestors: []       # origins allowed to embed it in an iframe
 *
 * Environment: METRONA_CONFIG (instead of the argument), SESSION_SECRET (keeps sessions across
 * restarts), DASHBOARD_PASSWORD_HASH, DASHBOARD_PORT, DASHBOARD_HOST.
 */

const fs = require('fs');
const yaml = require('js-yaml');
const { ServerDashboard } = require('./server-dashboard');

function loadConfig(file) {
  if (!file) throw new Error('Pass the config file path, or set METRONA_CONFIG');
  const config = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  if (!Array.isArray(config.sites) || config.sites.length === 0) throw new Error(`${file}: no sites configured`);
  return config;
}

function dashboardOptions(config, env = process.env) {
  const d = config.dashboard || {};
  const port = Number(env.DASHBOARD_PORT || d.port || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid dashboard port: ${port}`);
  return {
    host: env.DASHBOARD_HOST || d.host || '127.0.0.1',
    port,
    dataDir: d.dataDir || '/var/lib/metrona/dashboard',
    passwordHash: env.DASHBOARD_PASSWORD_HASH || d.passwordHash || undefined,
    httpsOnly: d.httpsOnly !== false,
    frameAncestors: Array.isArray(d.frameAncestors) ? d.frameAncestors : [],
    sessionSecret: env.SESSION_SECRET || undefined,
    sites: config.sites
      .filter((s) => s.enabled !== false)
      .map((s) => ({ siteId: s.siteId, name: s.siteName, domain: s.domain, enabled: true })),
  };
}

async function main() {
  const config = loadConfig(process.argv[2] || process.env.METRONA_CONFIG);
  const dashboard = new ServerDashboard(dashboardOptions(config));
  await dashboard.start();
  const stop = () => dashboard.stop().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Dashboard failed to start: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { loadConfig, dashboardOptions };
