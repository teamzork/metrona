/**
 * @fileoverview `metrona mcp`: the read-only MCP server over stdio (package @metrona/mcp).
 * stdout belongs to the protocol, so nothing else may print there.
 */

const fs = require('fs');
const { configPath, loadConfig, dashboardDataDir } = require('./common');

async function mcp(options) {
  let config = null;
  const file = configPath(options.config);
  if (!options.dataDir && !process.env.METRONA_DATA_DIR && fs.existsSync(file)) {
    config = loadConfig(file);
  }
  const { serveStdio } = await import('@metrona/mcp');
  await serveStdio({ dataDir: dashboardDataDir(config, options.dataDir), version: require('../../package.json').version });
}

module.exports = { mcp };
