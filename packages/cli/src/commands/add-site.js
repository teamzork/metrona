/**
 * @fileoverview `metrona add-site`: add one site to a Metrona that's already installed, keeping
 * every site already in metrona.yaml and the rest of the file. With --stats it also writes the
 * site's /stats/ snippet, reusing the existing password. Then it restarts the running services.
 *
 *   sudo metrona add-site example.com=/var/log/nginx/example.com-access.log --stats
 *
 * The web server is taken from the sites already there (pass --server when they're mixed).
 * metrona.yaml is copied to metrona.yaml.bak first. Comments at the top of the file are kept;
 * comments further down aren't, since the file is written anew.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { DEFAULTS, configPath, loadConfig, publishDir } = require('./common');
const { siteEntry, parseSiteOption, writeStats, ownStatsFiles, sh, SERVERS, STATS } = require('./init');

const UNIT = '/etc/systemd/system/metrona-scheduler.service';

/** The web server the existing sites' logs come from, if they agree on one. */
function serverOf(sites) {
  const formats = [...new Set(sites.map((s) => s.format))];
  const server = formats.length === 1 && Object.keys(SERVERS).find((k) => SERVERS[k].format === formats[0]);
  if (!server) throw new Error(`Can't tell the web server from the sites already configured (formats: ${formats.join(', ')}). Pass --server nginx or --server caddy.`);
  return server;
}

/** Which existing site already has this domain, if any. */
function clash(sites, entry) {
  const names = (s) => [s.domain, ...(s.aliases || [])].filter(Boolean).map((d) => d.toLowerCase());
  return sites.find((s) => s.siteId === entry.siteId || names(s).some((d) => names(entry).includes(d)));
}

/** The comment lines at the top of a YAML file. */
function leadingComments(text) {
  const lines = text.split('\n');
  const end = lines.findIndex((l) => !/^\s*(#|$)/.test(l));
  const head = lines.slice(0, end === -1 ? lines.length : end).join('\n').trimEnd();
  return head ? `${head}\n` : '';
}

/** Replace a file in one step, keeping its mode and owner. */
function replaceFile(file, text) {
  const { mode, uid, gid } = fs.statSync(file);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: mode & 0o777 });
  try {
    fs.chownSync(tmp, uid, gid);
  } catch {
    // Not root: the file stays ours, which it already was.
  }
  fs.renameSync(tmp, file);
}

/**
 * Whether the metrona user can read the log, going by its groups and the unit's
 * SupplementaryGroups. null when it can't be told (no log yet, or no such user here).
 */
function metronaCanRead(logPath, unitText) {
  let stat;
  let groups;
  try {
    stat = fs.statSync(logPath);
    groups = execFileSync('id', ['-Gn', 'metrona'], { encoding: 'utf8' }).trim().split(/\s+/);
  } catch {
    return null;
  }
  const extra = /^SupplementaryGroups=(.*)$/m.exec(unitText || '');
  if (extra) groups.push(...extra[1].trim().split(/\s+/));
  if (stat.mode & 0o004) return true;
  if (!(stat.mode & 0o040)) return false;
  try {
    const name = execFileSync('getent', ['group', String(stat.gid)], { encoding: 'utf8' }).split(':')[0];
    return groups.includes(name);
  } catch {
    return null;
  }
}

/**
 * @param {Object} options
 * @param {string} options.site - domain=logPath
 * @returns {Promise<Object>} What was done, for printNextSteps
 */
async function addSite(options) {
  const root = path.resolve(options.root || '/');
  const system = root === '/' && options.system !== false;
  if (system && process.getuid && process.getuid() !== 0) {
    throw new Error('add-site changes files in /etc/metrona: run it with sudo, or pass --root <dir> to try it on a copy.');
  }
  const at = (p) => path.join(root, p);
  const configFile = at(configPath(options.config));
  const config = loadConfig(configFile);

  const server = options.server || serverOf(config.sites);
  if (!SERVERS[server]) throw new Error(`--server is nginx or caddy, not "${server}"`);
  const entry = siteEntry(server, parseSiteOption(options.site || ''), Boolean(options.cloudflare));
  const taken = clash(config.sites, entry);
  if (taken) throw new Error(`${entry.domain} is already set up, as site "${taken.siteId}" (${taken.logPath}).`);
  const { ConfigurationManager } = require('@metrona/scheduler');
  new ConfigurationManager().validateSiteConfiguration(entry);

  // /stats/ by default when the install already publishes pages.
  const stats = options.stats === undefined ? Boolean(publishDir(config)) : Boolean(options.stats);
  const updated = { ...config, sites: [...config.sites, entry] };
  if (stats && !publishDir(config)) updated.publish = { ...(config.publish || {}), dir: DEFAULTS.publish };
  if (!config.dashboard || Object.keys(config.dashboard).length === 0) delete updated.dashboard;

  const text = fs.readFileSync(configFile, 'utf8');
  fs.copyFileSync(configFile, `${configFile}.bak`);
  replaceFile(configFile, leadingComments(text) + yaml.dump(updated, { lineWidth: -1 }));
  const written = [configFile, `${configFile}.bak`];

  let password = null;
  let statsFiles = [];
  if (stats) {
    const result = writeStats({ at, server, sites: [entry], publishDir: publishDir(updated) });
    ({ password, files: statsFiles } = result);
    written.push(...result.written);
  }

  const warnings = [];
  const unitText = fs.existsSync(at(UNIT)) ? fs.readFileSync(at(UNIT), 'utf8') : null;
  // A unit that starts the scheduler daemon directly only publishes with --publish-dir;
  // `metrona scheduler` reads publish.dir from the config.
  if (stats && unitText && /daemon\.js/.test(unitText) && !/--publish-dir/.test(unitText)) {
    warnings.push(`${UNIT} starts the scheduler without --publish-dir, so it won't write the page. Add --publish-dir ${publishDir(updated)} to its ExecStart, then: sudo systemctl daemon-reload`);
  }
  let restarted = false;
  if (system) {
    if (metronaCanRead(entry.logPath, unitText) === false) {
      warnings.push(`The metrona user can't read ${entry.logPath}. Add it to the log's group, or the unit's SupplementaryGroups.`);
    }
    if (stats) ownStatsFiles(server, [...statsFiles, at(STATS.htpasswd)]);
    if (options.restart !== false) {
      // Only the services that are running; a stopped one reads the config when it starts.
      sh('systemctl', ['try-restart', 'metrona-scheduler', 'metrona-dashboard']);
      restarted = true;
    }
  }

  return { site: entry, server, written, system, restarted, stats, password, statsFiles, warnings };
}

function printNextSteps({ site, server, written, system, restarted, stats, password, statsFiles, warnings }) {
  console.log(`\nAdded ${site.domain} as site "${site.siteId}", reading ${site.logPath}.`);
  console.log('\nWrote:');
  for (const f of written) console.log(`  ${f}`);
  if (server === 'nginx') {
    console.log(`\nIn ${site.domain}'s server block, make sure nginx writes that log:\n  access_log ${site.logPath};`);
  } else {
    console.log(`\nIn ${site.domain}'s site block, make sure Caddy writes that log:\n  log {\n    output file ${site.logPath}\n  }`);
  }
  if (stats) {
    const how = server === 'nginx' ? 'include' : 'import';
    console.log(`\nIts stats page will be https://${site.domain}${STATS.path} (user "${STATS.user}").`);
    if (password) console.log(`  Password: ${password}\n  (shown only now; only its hash is stored)`);
    else console.log('  The password is the one the other sites use.');
    console.log(`  To switch it on, ${how} the snippet in the same block:`);
    for (const f of statsFiles) console.log(`    ${how} ${server === 'nginx' ? `${f};` : f}`);
  }
  console.log(`\nThen: ${server === 'nginx' ? 'sudo nginx -t && sudo systemctl reload nginx' : 'sudo systemctl reload caddy'}`);
  for (const w of warnings) console.log(`\n⚠ ${w}`);
  console.log('\nNext:');
  if (!system) console.log('  (--root: only the files under it were changed)');
  else if (restarted) console.log('  The running Metrona services were restarted; the new site is counted on the next run.');
  else console.log('  sudo systemctl restart metrona-scheduler   # to pick up the new site');
  console.log('  npx metrona status                 # each site, its log, its last update\n');
}

module.exports = { addSite, printNextSteps, serverOf, clash, leadingComments };
