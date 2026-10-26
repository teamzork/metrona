const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { init, buildConfig, siteIdFor, parseSiteOption, units, envFileText } = require('./init');

describe('metrona init', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'metrona-init-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const run = (extra = {}) => init({
    root,
    yes: true,
    server: 'nginx',
    site: ['example.com=/var/log/nginx/example.com-access.log', 'blog.example.org=/srv/logs/blog.log'],
    ...extra,
  });

  test('writes the config, the secrets and both units under --root, without touching the system', async () => {
    const result = await run();
    expect(result.system).toBe(false);
    const config = yaml.load(fs.readFileSync(path.join(root, 'etc/metrona/metrona.yaml'), 'utf8'));
    expect(config.sites.map((s) => [s.siteId, s.format, s.aliases])).toEqual([
      ['example-com', 'nginx', ['www.example.com']],
      ['blog-example-org', 'nginx', undefined],
    ]);
    expect(config.dashboard).toMatchObject({ host: '127.0.0.1', port: 3001, dataDir: '/var/lib/metrona/dashboard' });
    expect(fs.statSync(path.join(root, 'etc/metrona/metrona.env')).mode & 0o777).toBe(0o640);
    expect(fs.existsSync(path.join(root, 'var/lib/metrona/dashboard'))).toBe(true);

    const unit = fs.readFileSync(path.join(root, 'etc/systemd/system/metrona-scheduler.service'), 'utf8');
    expect(unit).toContain('SupplementaryGroups=adm');
    expect(unit).toContain('ReadOnlyPaths=/srv/logs /var/log/nginx /etc/metrona');
    expect(unit).toMatch(/ExecStart=\S+ \S+index\.js scheduler --config \/etc\/metrona\/metrona\.yaml .* --run-now/);
  });

  test('refuses to replace a config without --force, and never changes the salt', async () => {
    await run();
    const salt = () => /VISITOR_HASH_SALT=(\w+)/.exec(fs.readFileSync(path.join(root, 'etc/metrona/metrona.env'), 'utf8'))[1];
    const first = salt();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await expect(run()).rejects.toThrow(/already exists/);
    await run({ force: true, server: 'caddy', site: ['example.com=/var/log/caddy/example.log'] });
    expect(salt()).toBe(first);
  });

  test('with --yes, needs a server and at least one site', async () => {
    await expect(init({ root, yes: true, server: 'nginx', site: [] })).rejects.toThrow(/--site/);
    await expect(init({ root, yes: true, server: 'apache', site: ['a.com=/x.log'] })).rejects.toThrow(/nginx or caddy/);
  });

  test('rejects a site the scheduler would reject', async () => {
    await expect(run({ site: ['example.com=relative/path.log'] })).rejects.toThrow();
  });
});

describe('init helpers', () => {
  test('site ids and --site values', () => {
    expect(siteIdFor('www.Example.com')).toBe('example-com');
    expect(parseSiteOption('a.com=/var/log/a.log')).toEqual({ domain: 'a.com', logPath: '/var/log/a.log' });
    expect(() => parseSiteOption('/var/log/a.log')).toThrow(/domain=logPath/);
  });

  test('caddy sites behind Cloudflare take the visitor IP from its header', () => {
    const config = buildConfig({ server: 'caddy', sites: [{ domain: 'a.com', logPath: '/var/log/caddy/a.log' }], cloudflare: true, port: 3001 });
    expect(config.sites[0].parserOptions).toEqual({ clientIpHeader: 'Cf-Connecting-Ip' });
  });

  test('units read logs through the right group, and allow a Node install under /home', () => {
    const u = units({ server: 'caddy', sites: [{ logPath: '/var/log/caddy/a.log' }], node: '/home/me/.nvm/bin/node', cli: '/home/me/metrona/index.js' });
    expect(u['metrona-scheduler.service']).toContain('SupplementaryGroups=caddy');
    expect(u['metrona-scheduler.service']).toContain('ProtectHome=read-only');
    expect(u['metrona-dashboard.service']).toContain('dashboard --config /etc/metrona/metrona.yaml');
  });

  test('keeps existing secrets', () => {
    expect(envFileText('VISITOR_HASH_SALT=abc\nSESSION_SECRET=def\n')).toContain('VISITOR_HASH_SALT=abc\nSESSION_SECRET=def');
  });
});
