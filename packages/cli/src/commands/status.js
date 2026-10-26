/**
 * @fileoverview `metrona status`: for each site, whether its log can be read and when its numbers
 * were last written. Exits non-zero when something needs a look.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { configPath, loadConfig, dashboardDataDir, ago } = require('./common');

/** Hours without an update before a site counts as stale (the scheduler runs hourly). */
const STALE_HOURS = 3;

function siteStatus(site, dataDir, now = Date.now()) {
  const problems = [];
  let log = 'readable';
  try {
    fs.accessSync(site.logPath, fs.constants.R_OK);
    const stat = fs.statSync(site.logPath);
    log = `${(stat.size / 1024).toFixed(0)} KB, written ${ago(stat.mtime, now)}`;
  } catch (error) {
    log = error.code === 'ENOENT' ? 'missing' : error.code === 'EACCES' ? 'not readable (permission denied)' : error.message;
    problems.push(`log ${site.logPath} is ${log}`);
  }

  let numbers = null;
  const file = path.join(dataDir, `${site.siteId}.yaml`);
  try {
    const data = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    const updated = new Date(data.metadata && data.metadata.generated_at);
    const summary = data.summary || {};
    numbers = { updated, pageviews: summary.total_pageviews || 0, visitors: summary.unique_visitors || 0 };
    if (Number.isNaN(updated.getTime())) problems.push(`${file} has no update time`);
    else if (now - updated.getTime() > STALE_HOURS * 3600 * 1000) problems.push(`numbers last written ${ago(updated, now)}: is the scheduler running?`);
  } catch (error) {
    problems.push(error.code === 'ENOENT' ? 'no numbers yet: the scheduler writes them hourly (or run `metrona run`)' : `${file}: ${error.message}`);
  }
  return { site, log, numbers, problems };
}

function status(options) {
  const file = configPath(options.config);
  const config = loadConfig(file);
  const dataDir = dashboardDataDir(config, options.dashboardData);
  const now = Date.now();
  const rows = config.sites.filter((s) => s.enabled !== false).map((s) => siteStatus(s, dataDir, now));

  if (options.json) {
    console.log(JSON.stringify(rows.map((r) => ({ siteId: r.site.siteId, domain: r.site.domain, log: r.log, ...r.numbers, problems: r.problems })), null, 2));
  } else {
    console.log(`\n${file} · numbers in ${dataDir}\n`);
    for (const r of rows) {
      const mark = r.problems.length ? '⚠' : '✓';
      const n = r.numbers ? `${r.numbers.pageviews} pageviews, ${r.numbers.visitors} visitors, updated ${ago(r.numbers.updated, now)}` : 'no numbers yet';
      console.log(`${mark} ${r.site.siteId} (${r.site.domain})`);
      console.log(`    ${n}`);
      console.log(`    log: ${r.log}`);
      for (const p of r.problems) console.log(`    → ${p}`);
    }
    console.log('');
  }
  return rows.filter((r) => r.problems.length).length;
}

module.exports = { status, siteStatus, STALE_HOURS };
