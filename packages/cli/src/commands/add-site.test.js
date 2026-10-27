const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { init } = require('./init');
const { addSite, serverOf, leadingComments } = require('./add-site');

describe('metrona add-site', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'metrona-add-site-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const file = (p) => path.join(root, p);
  const read = (p) => fs.readFileSync(file(p), 'utf8');
  const config = () => yaml.load(read('etc/metrona/metrona.yaml'));

  /** A config set up by hand, like one another project wrote: its own ids and fields. */
  function handWritten(extra = {}) {
    const text = `# Shared Metrona: the podcast site's admin reads opd.yaml\n\n${yaml.dump({
      version: '1.0',
      sites: [{ siteId: 'opd', siteName: 'OPD', domain: 'podcasts.example', logPath: '/var/log/nginx/opd.log', format: 'nginx', schedule: 'hourly', timezone: 'UTC', rotationNaming: 'suffix' }],
      ...extra,
    })}`;
    fs.mkdirSync(file('etc/metrona'), { recursive: true });
    fs.writeFileSync(file('etc/metrona/metrona.yaml'), text, { mode: 0o640 });
    return text;
  }

  test('adds a site to an init install, reusing the /stats/ password', async () => {
    await init({ root, yes: true, server: 'nginx', site: ['example.com=/var/log/nginx/example.com-access.log'], stats: true });
    const htpasswd = read('etc/metrona/stats.htpasswd');

    const result = await addSite({ root, site: 'blog.example.org=/var/log/nginx/blog.log' });

    expect(config().sites.map((s) => s.siteId)).toEqual(['example-com', 'blog-example-org']);
    expect(config().publish).toEqual({ dir: '/var/lib/metrona/public' });
    expect(read('etc/metrona/metrona.yaml')).toMatch(/^# Metrona's configuration, written by `metrona init`/);
    expect(config().dashboard.port).toBe(3001);
    expect(yaml.load(read('etc/metrona/metrona.yaml.bak')).sites).toHaveLength(1);

    expect(result).toMatchObject({ server: 'nginx', stats: true, password: null, system: false });
    expect(read('etc/metrona/stats.htpasswd')).toBe(htpasswd);
    const snippet = read('etc/metrona/web/blog-example-org.nginx.conf');
    expect(snippet).toContain('alias /var/lib/metrona/public/blog-example-org/;');
    expect(snippet).toContain('auth_basic "Stats for blog.example.org"');
  });

  test('keeps a hand-written config as it was, with the new site after it', async () => {
    const before = handWritten({ publish: { dir: '/srv/metrona/public' } });

    await addSite({ root, site: 'example.com=/var/log/nginx/example.com-metrona.log' });

    const after = config();
    expect(after.sites[0]).toEqual(yaml.load(before).sites[0]);
    expect(after.sites[1]).toMatchObject({ siteId: 'example-com', domain: 'example.com', aliases: ['www.example.com'], format: 'nginx' });
    expect(after).not.toHaveProperty('dashboard');
    expect(read('etc/metrona/metrona.yaml')).toMatch(/^# Shared Metrona: the podcast site's admin reads opd.yaml\n/);
    expect(fs.statSync(file('etc/metrona/metrona.yaml')).mode & 0o777).toBe(0o640);
    // Its own publish folder, and a new password since there was none.
    expect(read('etc/metrona/web/example-com.nginx.conf')).toContain('alias /srv/metrona/public/example-com/;');
    expect(fs.existsSync(file('etc/metrona/stats.htpasswd'))).toBe(true);
  });

  test('no /stats/ unless asked, when the install has none; --stats sets publishing up', async () => {
    handWritten();
    let result = await addSite({ root, site: 'a.example=/var/log/nginx/a.log' });
    expect(result.stats).toBe(false);
    expect(config()).not.toHaveProperty('publish');
    expect(fs.existsSync(file('etc/metrona/web'))).toBe(false);

    result = await addSite({ root, site: 'b.example=/var/log/nginx/b.log', stats: true });
    expect(result.password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(config().publish).toEqual({ dir: '/var/lib/metrona/public' });
    expect(fs.existsSync(file('etc/metrona/web/b-example.nginx.conf'))).toBe(true);
  });

  test('refuses a site that is already there, by domain, www. or id', async () => {
    await init({ root, yes: true, server: 'nginx', site: ['example.com=/var/log/nginx/example.com-access.log'] });
    for (const site of ['example.com=/var/log/nginx/other.log', 'www.example.com=/var/log/nginx/other.log']) {
      await expect(addSite({ root, site })).rejects.toThrow(/already set up, as site "example-com"/);
    }
    expect(config().sites).toHaveLength(1);
  });

  test("rejects a bad site without touching the config", async () => {
    const before = handWritten();
    await expect(addSite({ root, site: 'a.example=relative.log' })).rejects.toThrow();
    await expect(addSite({ root, site: '/var/log/a.log' })).rejects.toThrow(/domain=logPath/);
    await expect(addSite({ root, site: 'a.example=/var/log/a.log', server: 'apache' })).rejects.toThrow(/nginx or caddy/);
    expect(read('etc/metrona/metrona.yaml')).toBe(before);
    expect(fs.existsSync(file('etc/metrona/metrona.yaml.bak'))).toBe(false);
  });

  test('says when the unit starts the daemon without --publish-dir', async () => {
    handWritten();
    fs.mkdirSync(file('etc/systemd/system'), { recursive: true });
    fs.writeFileSync(file('etc/systemd/system/metrona-scheduler.service'), 'ExecStart=/usr/bin/node /opt/metrona/packages/scheduler/src/daemon.js -c /etc/metrona/metrona.yaml\n');
    const result = await addSite({ root, site: 'a.example=/var/log/nginx/a.log', stats: true });
    expect(result.warnings.join('\n')).toMatch(/without --publish-dir/);
  });

  test('without a config, says how to make one', async () => {
    await expect(addSite({ root, site: 'a.example=/var/log/a.log' })).rejects.toThrow(/metrona init/);
  });
});

describe('add-site helpers', () => {
  test('the web server comes from the sites already there', () => {
    expect(serverOf([{ format: 'caddy' }, { format: 'caddy' }])).toBe('caddy');
    expect(() => serverOf([{ format: 'nginx' }, { format: 'caddy' }])).toThrow(/--server/);
  });

  test('the comments at the top are kept', () => {
    expect(leadingComments('# one\n# two\n\nversion: 1\n# later\n')).toBe('# one\n# two\n');
    expect(leadingComments('version: 1\n')).toBe('');
  });
});
