/**
 * @fileoverview `metrona publish`: write each site's page as static files now, from the numbers
 * already on disk (the scheduler does the same after every run when publish.dir is set).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { configPath, loadConfig, dashboardDataDir, publishDir, enabledSites } = require('./common');

async function publish(options) {
  const config = loadConfig(configPath(options.config));
  const dir = publishDir(config, options.dir);
  if (!dir) throw new Error('No publish folder: set publish.dir in metrona.yaml (metrona init --stats does), or pass --dir.');
  const dataDir = dashboardDataDir(config, options.dashboardData);
  const { publishSite } = require('@metrona/dashboard');
  let missing = 0;
  for (const site of enabledSites(config, options.site)) {
    const file = path.join(dataDir, `${site.siteId}.yaml`);
    if (!fs.existsSync(file)) {
      missing++;
      console.error(`✗ ${site.siteId}: no numbers yet in ${file} (run \`metrona run\` first)`);
      continue;
    }
    const data = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    const page = await publishSite({ data, site: { siteId: site.siteId, name: site.siteName, domain: site.domain }, dir });
    console.log(`✓ ${site.siteId}: ${page}`);
  }
  return missing;
}

module.exports = { publish };
