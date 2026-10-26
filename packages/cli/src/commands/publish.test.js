const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const bcrypt = require('bcryptjs');
const { init, statsSnippet, newPassword } = require('./init');
const { publish } = require('./publish');

const DEMO = path.join(__dirname, '../../demo-data/example-com.yaml');

describe('metrona init --stats', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'metrona-stats-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const run = (extra = {}) => init({ root, yes: true, stats: true, server: 'nginx', site: ['example.com=/var/log/nginx/example.com-access.log'], ...extra });

  test('turns publishing on, makes a password, and writes a snippet per site', async () => {
    const result = await run({ site: ['example.com=/var/log/nginx/a.log', 'blog.example.org=/var/log/nginx/b.log'] });
    const config = yaml.load(fs.readFileSync(path.join(root, 'etc/metrona/metrona.yaml'), 'utf8'));
    expect(config.publish).toEqual({ dir: '/var/lib/metrona/public' });
    expect(result.password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);

    const htpasswd = fs.readFileSync(path.join(root, 'etc/metrona/stats.htpasswd'), 'utf8');
    const [user, hash] = htpasswd.trim().split(':');
    expect(user).toBe('stats');
    expect(bcrypt.compareSync(result.password, hash)).toBe(true);
    expect(htpasswd).not.toContain(result.password);

    const snippet = fs.readFileSync(path.join(root, 'etc/metrona/web/blog-example-org.nginx.conf'), 'utf8');
    expect(snippet).toContain('alias /var/lib/metrona/public/blog-example-org/;');
    expect(snippet).toContain('auth_basic_user_file /etc/metrona/stats.htpasswd;');
    expect(snippet).toContain('X-Robots-Tag "noindex, nofollow"');
    // Behind a proxy that ends HTTPS, an absolute redirect would point at http://
    expect(snippet).toContain('location = /stats { absolute_redirect off; return 301 /stats/; }');
  });

  test('keeps the password on a second run, and replaces it only when asked', async () => {
    const first = await run();
    const file = path.join(root, 'etc/metrona/stats.htpasswd');
    const hash = fs.readFileSync(file, 'utf8');
    const again = await run({ force: true });
    expect(again.password).toBeNull();
    expect(fs.readFileSync(file, 'utf8')).toBe(hash);
    const renewed = await run({ force: true, newPassword: true });
    expect(renewed.password).not.toBe(first.password);
    expect(fs.readFileSync(file, 'utf8')).not.toBe(hash);
  });

  test('without --stats, nothing about /stats/ is written', async () => {
    await run({ stats: false });
    const config = yaml.load(fs.readFileSync(path.join(root, 'etc/metrona/metrona.yaml'), 'utf8'));
    expect(config.publish).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'etc/metrona/stats.htpasswd'))).toBe(false);
  });

  test('a Caddy snippet carries the hash inside basic_auth', () => {
    const text = statsSnippet('caddy', { siteId: 'example-com', domain: 'example.com' }, '$2a$12$abc');
    expect(text).toContain('handle_path /stats/* {');
    expect(text).toContain('root * /var/lib/metrona/public/example-com');
    expect(text).toMatch(/basic_auth \{\n\t\tstats \$2a\$12\$abc\n\t\}/);
  });

  test('passwords are long and differ', () => {
    const a = newPassword();
    expect(a.replace(/-/g, '')).toHaveLength(16);
    expect(newPassword()).not.toBe(a);
  });
});

describe('metrona publish', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrona-publish-'));
    fs.mkdirSync(path.join(dir, 'data'));
    fs.copyFileSync(DEMO, path.join(dir, 'data', 'example-com.yaml'));
    fs.writeFileSync(path.join(dir, 'metrona.yaml'), yaml.dump({
      sites: [
        { siteId: 'example-com', siteName: 'Example', domain: 'example.com', logPath: '/var/log/nginx/example.log', schedule: 'hourly' },
        { siteId: 'no-data', siteName: 'New', domain: 'new.example.com', logPath: '/var/log/nginx/new.log', schedule: 'hourly' },
      ],
      dashboard: { dataDir: path.join(dir, 'data') },
      publish: { dir: path.join(dir, 'public') },
    }));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("writes each site's page with its assets, and says which sites have no numbers yet", async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const missing = await publish({ config: path.join(dir, 'metrona.yaml') });
    expect(missing).toBe(1);
    expect(errors.mock.calls.join('\n')).toMatch(/no-data: no numbers yet/);
    const page = fs.readFileSync(path.join(dir, 'public/example-com/index.html'), 'utf8');
    expect(page).toContain('<link rel="stylesheet" href="assets/site.css">');
    expect(page).toContain('15,420');
    expect(page).not.toContain('data-logout');
    for (const asset of ['site.css', 'site.js']) expect(fs.existsSync(path.join(dir, 'public/example-com/assets', asset))).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'public/example-com')).some((f) => f.includes('.tmp-'))).toBe(false);
    jest.restoreAllMocks();
  });

  test('needs a publish folder', async () => {
    const config = yaml.load(fs.readFileSync(path.join(dir, 'metrona.yaml'), 'utf8'));
    delete config.publish;
    fs.writeFileSync(path.join(dir, 'metrona.yaml'), yaml.dump(config));
    await expect(publish({ config: path.join(dir, 'metrona.yaml') })).rejects.toThrow(/publish.dir/);
  });
});
