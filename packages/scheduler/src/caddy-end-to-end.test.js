/**
 * Caddy JSON log → scheduler job → dataset → dashboard file → dashboard render.
 */

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const yaml = require('js-yaml');
const { JobExecutor } = require('./job-executor');
const { StaticDashboard } = require('../../dashboard/src/static-dashboard');

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

function caddyLine({ ts, ip = '203.0.113.7', uri = '/', ua = BROWSER, referer, status = 200, type = 'text/html; charset=utf-8', extraHeaders = {} }) {
  const headers = { 'User-Agent': [ua], ...extraHeaders };
  if (referer) headers.Referer = [referer];
  return JSON.stringify({
    level: 'info', ts, logger: 'http.log.access', msg: 'handled request',
    request: { remote_ip: ip, client_ip: ip, method: 'GET', host: 'hairdesign.example.com', uri, headers },
    status, size: 1000, duration: 0.01, resp_headers: { 'Content-Type': [type] },
  });
}

describe('Caddy end to end', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metrona-caddy-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('turns a Caddy log (with a rolled, gzipped file) into a dashboard dataset', async () => {
    const day1 = Date.UTC(2026, 9, 4, 15) / 1000;
    const day2 = Date.UTC(2026, 9, 5, 15) / 1000;
    const logPath = path.join(dir, 'hairdesign.log');

    // Yesterday, rolled by Caddy and compressed.
    const rolled = [
      caddyLine({ ts: day1, uri: '/', referer: 'https://l.instagram.com/' }),
      caddyLine({ ts: day1 + 5, uri: '/start', referer: 'https://hairdesign.example.com/' }),
    ].join('\n') + '\n';
    await fs.writeFile(path.join(dir, 'hairdesign-2026-10-05T00-00-00.000.log.gz'), zlib.gzipSync(rolled));

    // Today: one real pageview per visitor plus noise that must not count.
    await fs.writeFile(logPath, [
      caddyLine({ ts: day2, ip: '198.51.100.1', uri: '/faq', referer: 'https://www.google.com/' }),
      caddyLine({ ts: day2 + 1, ip: '198.51.100.2', uri: '/r/secretToken123/review' }),
      caddyLine({ ts: day2 + 2, uri: '/_next/static/chunks/main.js', type: 'application/javascript' }),
      caddyLine({ ts: day2 + 3, uri: '/faq?_rsc=1', type: 'text/x-component', extraHeaders: { Rsc: ['1'] } }),
      caddyLine({ ts: day2 + 4, uri: '/', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }),
      caddyLine({ ts: day2 + 5, uri: '/missing', status: 404 }),
      '{"level":"info","msg":"not an access log line"}',
    ].join('\n') + '\n');

    const outputDir = path.join(dir, 'datasets');
    const dashboardDataDir = path.join(dir, 'dashboard');
    await fs.mkdir(outputDir);
    const executor = new JobExecutor({ outputDir, dashboardDataDir, salt: 'test-salt' });
    const site = {
      siteId: 'hairdesign',
      siteName: 'Hair design',
      domain: 'hairdesign.example.com',
      logPath,
      format: 'caddy',
      timezone: 'America/Los_Angeles',
      parserOptions: { collapsePrefixes: ['/r/'] },
    };

    const result = await executor.createSiteProcessingJob(site)();
    expect(result.success).toBe(true);
    expect(result.analytics.totalPageviews).toBe(4);
    expect(result.outputPath).toBe(path.join(outputDir, 'analytics-hairdesign.yaml'));

    const view = yaml.load(await fs.readFile(path.join(dashboardDataDir, 'hairdesign.yaml'), 'utf8'));
    expect(view.metadata.site_id).toBe('hairdesign');
    expect(view.summary.total_pageviews).toBe(4);
    expect(view.summary.unique_visitors).toBe(3);
    const paths = view.top_pages.map((p) => p.path).sort();
    expect(paths).toEqual(['/', '/faq', '/r/:token', '/start']);
    expect(JSON.stringify(view)).not.toContain('secretToken123');
    // Internal navigation isn't a referral; Instagram and Google are.
    expect(view.referrers.by_domain.map((r) => r.domain).sort()).toEqual(['l.instagram.com', 'www.google.com']);
    expect(view.time_series.daily.map((d) => [d.date, d.pageviews])).toEqual([['2026-10-04', 2], ['2026-10-05', 2]]);

    // A second run over the same logs replaces the numbers instead of adding to them.
    await executor.createSiteProcessingJob(site)();
    const again = yaml.load(await fs.readFile(path.join(dashboardDataDir, 'hairdesign.yaml'), 'utf8'));
    expect(again.summary.total_pageviews).toBe(4);
    expect(again.time_series.daily.map((d) => d.pageviews)).toEqual([2, 2]);

    // And the dashboard renders it.
    const dashboard = new StaticDashboard({ dataDir: dashboardDataDir, sites: [{ siteId: 'hairdesign', domain: site.domain, enabled: true }] });
    const data = await dashboard.loadSiteData('hairdesign');
    expect(data.summary.total_pageviews).toBe(4);
  });

  test('reads an nginx log whose rolled files are dated, with rotationNaming: caddy', async () => {
    const logPath = path.join(dir, 'dimka.log');
    const line = (day, ip, uri) => `${ip} - - [${day}/Oct/2026:15:00:00 +0000] "GET ${uri} HTTP/1.1" 200 512 "-" "${BROWSER}"`;
    await fs.writeFile(path.join(dir, 'dimka-2026-10-04T00-00-00.000.log'), line('04', '203.0.113.7', '/') + '\n');
    await fs.writeFile(path.join(dir, 'dimka-2026-10-05T00-00-00.000.log'), line('05', '203.0.113.7', '/blog') + '\n');
    await fs.writeFile(logPath, line('06', '198.51.100.1', '/movies') + '\n');

    const dashboardDataDir = path.join(dir, 'dashboard');
    await fs.mkdir(path.join(dir, 'datasets'));
    const executor = new JobExecutor({ outputDir: path.join(dir, 'datasets'), dashboardDataDir, salt: 'test-salt' });
    const site = { siteId: 'dimka', siteName: 'dimka.com', domain: 'dimka.com', logPath, format: 'nginx', rotationNaming: 'caddy' };
    const result = await executor.createSiteProcessingJob(site)();
    expect(result.success).toBe(true);

    const view = yaml.load(await fs.readFile(path.join(dashboardDataDir, 'dimka.yaml'), 'utf8'));
    expect(view.summary.total_pageviews).toBe(3);
    expect(view.time_series.daily.map((d) => d.date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
  });

  test('rejects an unknown log format', () => {
    const executor = new JobExecutor({ outputDir: dir });
    expect(() => executor.createSiteProcessingJob({ siteId: 'x', siteName: 'X', domain: 'x.example.com', logPath: '/tmp/x.log', format: 'apache' })).toThrow(/Unsupported log format/);
  });
});

describe('dataset merge at the rotation boundary', () => {
  test('keeps the fuller count for the oldest, partially logged period', () => {
    const { YamlDatasetWriter } = require('../../parser/src/utils/yaml-writer');
    const writer = new YamlDatasetWriter();
    const merged = writer.mergeTimeSeriesPeriod(
      { buckets: [{ timestamp: '2026-10-01T00:00:00.000Z', pageviews: 40 }, { timestamp: '2026-10-02T00:00:00.000Z', pageviews: 30 }] },
      { groupBy: 'daily', timezone: 'UTC', buckets: [{ timestamp: '2026-10-02T00:00:00.000Z', pageviews: 12 }, { timestamp: '2026-10-03T00:00:00.000Z', pageviews: 25 }] }
    );
    expect(merged.buckets.map((b) => b.pageviews)).toEqual([40, 30, 25]);
  });
});
