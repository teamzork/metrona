/**
 * @fileoverview `metrona init`: set Metrona up on a server in one step. Asks for nginx or Caddy
 * and each site's log (or takes them as options), then writes metrona.yaml, the secrets in
 * metrona.env, and systemd units with the right group and log folders, creates the metrona user
 * and its folders, and reloads systemd.
 *
 *   sudo metrona init
 *   sudo metrona init --server caddy --site example.com=/var/log/caddy/example.log --yes --start
 *
 * --root <dir> writes everything under <dir> instead of / and skips the system steps, to see
 * what init would write (and for tests). An existing VISITOR_HASH_SALT is always kept.
 *
 * --stats is for sites with no dashboard of their own: the scheduler also writes each site's page
 * as static files (publish.dir), and init writes a password file and, per site, an nginx or
 * Caddy snippet that serves the page at /stats/ behind that password.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { DEFAULTS } = require('./common');

const SERVERS = {
  nginx: { group: 'adm', web: 'www-data', logDir: '/var/log/nginx', format: 'nginx', example: (d) => `/var/log/nginx/${d}-access.log` },
  caddy: { group: 'caddy', web: 'caddy', logDir: '/var/log/caddy', format: 'caddy', example: (d) => `/var/log/caddy/${d.split('.')[0]}.log` },
};

const STATS = {
  path: '/stats/',
  user: 'stats',
  htpasswd: '/etc/metrona/stats.htpasswd',
  snippets: '/etc/metrona/web',
};

const CLOUDFLARE_NGINX = 'https://github.com/teamzork/metrona/blob/main/templates/nginx/cloudflare.conf';

/** "www.Example.com" → "example-com" */
function siteIdFor(domain) {
  return domain.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** "example.com=/var/log/caddy/example.log" → { domain, logPath } */
function parseSiteOption(value) {
  const at = value.indexOf('=');
  if (at < 1) throw new Error(`--site takes domain=logPath, e.g. example.com=/var/log/nginx/example.com-access.log (got "${value}")`);
  return { domain: value.slice(0, at).trim().toLowerCase(), logPath: value.slice(at + 1).trim() };
}

function buildConfig({ server, sites, cloudflare, port, stats }) {
  const kind = SERVERS[server];
  const config = {
    version: '1.0',
    sites: sites.map(({ domain, logPath }) => {
      const bare = domain.replace(/^www\./, '');
      const site = {
        siteId: siteIdFor(domain),
        siteName: bare,
        domain: bare,
        logPath,
        format: kind.format,
        schedule: 'hourly',
        timezone: 'UTC',
      };
      // www. only for a bare domain: example.com has www.example.com, blog.example.com doesn't
      if (bare.split('.').length === 2) site.aliases = [`www.${bare}`];
      if (cloudflare && server === 'caddy') site.parserOptions = { clientIpHeader: 'Cf-Connecting-Ip' };
      return site;
    }),
    dashboard: {
      host: '127.0.0.1',
      port,
      dataDir: DEFAULTS.dashboardData,
      passwordHash: '',
      httpsOnly: true,
      frameAncestors: [],
    },
  };
  if (stats) config.publish = { dir: DEFAULTS.publish };
  return config;
}

/** "k7m2-qx9p-…": easy to read aloud and type, no 0/O or 1/l. */
function newPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return chars.match(/.{4}/g).join('-');
}

/** The web server's part of /stats/ for one site: nginx include or Caddy import. */
function statsSnippet(server, site, hash) {
  const dir = `${DEFAULTS.publish}/${site.siteId}`;
  if (server === 'nginx') {
    return `# Metrona: ${site.domain}'s stats page at ${STATS.path}, written by \`metrona init\`.
# In ${site.domain}'s server block (the HTTPS one), add:
#   include ${STATS.snippets}/${site.siteId}.nginx.conf;
# then: sudo nginx -t && sudo systemctl reload nginx
location = /stats { absolute_redirect off; return 301 /stats/; }
location ${STATS.path} {
    alias ${dir}/;
    index index.html;
    auth_basic "Stats for ${site.domain}";
    auth_basic_user_file ${STATS.htpasswd};
    add_header X-Robots-Tag "noindex, nofollow" always;
    add_header Cache-Control "no-cache" always;
}
`;
  }
  return `# Metrona: ${site.domain}'s stats page at ${STATS.path}, written by \`metrona init\`.
# Inside ${site.domain}'s site block, add:
#   import ${STATS.snippets}/${site.siteId}.caddy
# then: sudo systemctl reload caddy
redir /stats /stats/
handle_path /stats/* {
	root * ${dir}
	basic_auth {
		${STATS.user} ${hash}
	}
	header X-Robots-Tag "noindex, nofollow"
	header Cache-Control "no-cache"
	file_server
}
`;
}

const CONFIG_HEADER = `# Metrona's configuration, written by \`metrona init\`. The scheduler and the dashboard both read
# it; restart them after a change: sudo systemctl restart metrona-scheduler metrona-dashboard
# Every field: https://github.com/teamzork/metrona/blob/main/templates/config/metrona.yaml.example
`;

function envFileText(existing) {
  const keep = (key) => {
    const m = existing && new RegExp(`^${key}=(.+)$`, 'm').exec(existing);
    return m ? m[1].trim() : null;
  };
  const salt = keep('VISITOR_HASH_SALT') || crypto.randomBytes(32).toString('hex');
  const session = keep('SESSION_SECRET') || crypto.randomBytes(32).toString('hex');
  return `# Metrona's secrets. Never change VISITOR_HASH_SALT: every visitor afterwards would look new.
VISITOR_HASH_SALT=${salt}
SESSION_SECRET=${session}
`;
}

/** The two units. Paths inside them are the real system paths, whatever --root says. */
function units({ server, sites, node, cli }) {
  const kind = SERVERS[server];
  const logDirs = [...new Set(sites.map((s) => path.dirname(s.logPath)))].sort();
  // ProtectHome hides /home and /root; a per-user Node install (nvm) lives there.
  const home = /^\/(home|root)\//.test(cli) || /^\/(home|root)\//.test(node) ? 'read-only' : 'true';
  const hardening = `NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=${home}`;
  return {
    'metrona-scheduler.service': `# Written by \`metrona init\`.
[Unit]
Description=Metrona log processing (scheduler)
After=network.target

[Service]
Type=simple
User=metrona
Group=metrona
# Read the web server's logs
SupplementaryGroups=${kind.group}
ExecStart=${node} ${cli} scheduler --config ${DEFAULTS.config} --output ${DEFAULTS.datasets} --dashboard-data ${DEFAULTS.dashboardData} --run-now
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=10
EnvironmentFile=${DEFAULTS.envFile}
Environment=NODE_ENV=production TZ=UTC
${hardening}
ReadOnlyPaths=${[...logDirs, '/etc/metrona'].join(' ')}
ReadWritePaths=/var/lib/metrona

[Install]
WantedBy=multi-user.target
`,
    'metrona-dashboard.service': `# Written by \`metrona init\`.
[Unit]
Description=Metrona dashboard
After=network.target

[Service]
Type=simple
User=metrona
Group=metrona
ExecStart=${node} ${cli} dashboard --config ${DEFAULTS.config}
Restart=on-failure
RestartSec=5
EnvironmentFile=${DEFAULTS.envFile}
Environment=NODE_ENV=production TZ=UTC
${hardening}
ReadOnlyPaths=/etc/metrona ${DEFAULTS.dashboardData}

[Install]
WantedBy=multi-user.target
`,
  };
}

async function ask(options) {
  const inquirer = require('inquirer');
  let server = options.server;
  if (!server) {
    ({ server } = await inquirer.prompt([{ type: 'list', name: 'server', message: 'Which web server writes the access logs?', choices: ['nginx', 'caddy'] }]));
  }
  const sites = [];
  for (;;) {
    const { domain } = await inquirer.prompt([{
      type: 'input',
      name: 'domain',
      message: sites.length ? 'Another site (Enter to finish):' : 'Site domain (e.g. example.com):',
      validate: (v) => (sites.length || v.trim() ? true : 'At least one site'),
    }]);
    if (!domain.trim()) break;
    const d = domain.trim().toLowerCase();
    const { logPath } = await inquirer.prompt([{
      type: 'input',
      name: 'logPath',
      message: `Access log for ${d}:`,
      default: SERVERS[server].example(d),
      validate: (v) => (path.isAbsolute(v) ? true : 'An absolute path'),
    }]);
    sites.push({ domain: d, logPath });
  }
  let cloudflare = options.cloudflare;
  if (cloudflare === undefined) {
    ({ cloudflare } = await inquirer.prompt([{ type: 'confirm', name: 'cloudflare', message: "Are these sites behind Cloudflare's proxy (orange cloud)?", default: false }]));
  }
  let stats = options.stats;
  if (stats === undefined) {
    ({ stats } = await inquirer.prompt([{ type: 'confirm', name: 'stats', message: 'Show the numbers on each site at /stats/, behind a password? (For sites without an admin dashboard of their own.)', default: true }]));
  }
  return { server, sites, cloudflare, stats };
}

function write(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode });
  fs.chmodSync(file, mode);
}

function sh(cmd, args) {
  execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function groupExists(name) {
  try {
    execFileSync('getent', ['group', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<{ written: string[], config: Object }>}
 */
async function init(options) {
  const root = path.resolve(options.root || '/');
  const system = root === '/' && options.system !== false;
  if (system && process.getuid && process.getuid() !== 0) {
    throw new Error('init writes to /etc and creates a system user: run it with sudo, or pass --root <dir> to only see the files.');
  }

  let answers;
  if (options.yes || (options.server && options.site && options.site.length)) {
    if (!options.server || !options.site || !options.site.length) throw new Error('With --yes, pass --server and at least one --site domain=logPath.');
    answers = { server: options.server, sites: options.site.map(parseSiteOption), cloudflare: Boolean(options.cloudflare), stats: Boolean(options.stats) };
  } else {
    answers = await ask(options);
  }
  if (!SERVERS[answers.server]) throw new Error(`--server is nginx or caddy, not "${answers.server}"`);

  const config = buildConfig({ ...answers, port: Number(options.port || 3001) });
  const { ConfigurationManager } = require('@metrona/scheduler');
  const checker = new ConfigurationManager();
  for (const site of config.sites) checker.validateSiteConfiguration(site);

  const at = (p) => path.join(root, p);
  const configFile = at(DEFAULTS.config);
  if (fs.existsSync(configFile) && !options.force) {
    throw new Error(`${configFile} already exists. Pass --force to replace it (the salt in metrona.env is kept either way).`);
  }
  const envFile = at(DEFAULTS.envFile);
  const existingEnv = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null;

  const cli = fs.realpathSync(path.join(__dirname, '../index.js'));
  const unitFiles = units({ ...answers, node: process.execPath, cli });
  const written = [];

  write(configFile, CONFIG_HEADER + yaml.dump(config, { lineWidth: -1 }), 0o640);
  written.push(configFile);
  write(envFile, envFileText(existingEnv), 0o640);
  written.push(envFile);
  for (const [name, text] of Object.entries(unitFiles)) {
    const file = at(`/etc/systemd/system/${name}`);
    write(file, text, 0o644);
    written.push(file);
  }
  for (const dir of [DEFAULTS.datasets, DEFAULTS.dashboardData]) fs.mkdirSync(at(dir), { recursive: true });

  // /stats/: the password (kept unless --new-password) and the web server snippets.
  let password = null;
  const statsFiles = [];
  if (answers.stats) {
    fs.mkdirSync(at(DEFAULTS.publish), { recursive: true });
    const bcrypt = require('bcryptjs');
    const htpasswd = at(STATS.htpasswd);
    let hash = null;
    if (fs.existsSync(htpasswd) && !options.newPassword) {
      const line = fs.readFileSync(htpasswd, 'utf8').split('\n').find((l) => l.startsWith(`${STATS.user}:`));
      hash = line ? line.slice(STATS.user.length + 1).trim() : null;
    }
    if (!hash) {
      password = newPassword();
      hash = bcrypt.hashSync(password, 12);
      write(htpasswd, `${STATS.user}:${hash}\n`, 0o640);
      written.push(htpasswd);
    }
    for (const site of config.sites) {
      const file = at(`${STATS.snippets}/${site.siteId}.${answers.server === 'nginx' ? 'nginx.conf' : 'caddy'}`);
      write(file, statsSnippet(answers.server, site, hash), 0o640);
      written.push(file);
      statsFiles.push(file);
    }
  }

  if (system) {
    try {
      execFileSync('id', ['metrona'], { stdio: 'ignore' });
    } catch {
      sh('useradd', ['--system', '--home', '/var/lib/metrona', '--shell', '/usr/sbin/nologin', 'metrona']);
    }
    const group = SERVERS[answers.server].group;
    if (groupExists(group)) sh('usermod', ['-aG', group, 'metrona']);
    else console.warn(`⚠ There's no "${group}" group here; make sure the metrona user can read the logs.`);
    sh('chown', ['-R', 'metrona:metrona', '/var/lib/metrona']);
    sh('chown', ['root:metrona', configFile, envFile]);
    if (answers.stats) {
      // The web server reads the password file and snippets as its own user.
      const web = SERVERS[answers.server].web;
      const files = [...statsFiles, ...(fs.existsSync(at(STATS.htpasswd)) ? [at(STATS.htpasswd)] : [])];
      if (groupExists(web)) sh('chown', [`root:${web}`, ...files]);
      else for (const f of files) fs.chmodSync(f, 0o644);
    }
    sh('systemctl', ['daemon-reload']);
    if (options.start) {
      // restart, not just start: a running scheduler would keep its old config and groups.
      sh('systemctl', ['enable', 'metrona-scheduler', 'metrona-dashboard']);
      sh('systemctl', ['restart', 'metrona-scheduler', 'metrona-dashboard']);
    }
  }

  return { written, config, system, started: system && Boolean(options.start), cloudflare: answers.cloudflare, server: answers.server, stats: answers.stats, password, statsFiles };
}

function printNextSteps({ written, config, system, started, cloudflare, server, stats, password, statsFiles = [] }) {
  console.log('\nWrote:');
  for (const f of written) console.log(`  ${f}`);
  console.log(`\nSites: ${config.sites.map((s) => `${s.siteId} (${s.logPath})`).join(', ')}`);
  if (cloudflare && server === 'nginx') {
    console.log(`\nBehind Cloudflare with nginx: the log must carry the visitor's IP, not Cloudflare's. Use\n  ${CLOUDFLARE_NGINX}\nand point each site's logPath at the log it writes.`);
  }
  if (stats) {
    console.log(`\nStats pages, behind a password (user "${STATS.user}"):`);
    for (const s of config.sites) console.log(`  https://${s.domain}${STATS.path}`);
    if (password) console.log(`  Password: ${password}\n  (shown only now; only its hash is stored. A new one: metrona init --stats --new-password --force)`);
    else console.log('  The existing password is kept.');
    const how = server === 'nginx' ? 'include' : 'import';
    console.log(`\n  To switch them on, ${how} each site's snippet in its ${server === 'nginx' ? 'server' : 'site'} block:`);
    for (const f of statsFiles) console.log(`    ${how} ${server === 'nginx' ? `${f};` : f}`);
    console.log(`  then ${server === 'nginx' ? 'sudo nginx -t && sudo systemctl reload nginx' : 'sudo systemctl reload caddy'}`);
  }
  console.log('\nNext:');
  if (!system) console.log('  (--root: nothing was installed; copy the files into place to use them)');
  else if (!started) console.log('  sudo systemctl enable --now metrona-scheduler metrona-dashboard');
  console.log('  npx metrona status                 # each site, its log, its last update');
  console.log(`  Put the dashboard (127.0.0.1:${config.dashboard.port}) behind HTTPS and a password on your web server:`);
  console.log('  https://github.com/teamzork/metrona/blob/main/Docs/setup.md#5-put-the-dashboard-online\n');
}

module.exports = { init, printNextSteps, buildConfig, siteIdFor, parseSiteOption, units, envFileText, statsSnippet, newPassword, STATS };
