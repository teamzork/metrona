const { CaddyLogParser } = require('./caddy');
const { NginxLogParser } = require('./nginx');
const { isLikelyBot } = require('../utils/bot-filter');

const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function line(overrides = {}) {
  const { request = {}, ...rest } = overrides;
  return JSON.stringify({
    level: 'info',
    ts: 1759750000.5,
    logger: 'http.log.access.log0',
    msg: 'handled request',
    request: {
      remote_ip: '172.68.1.10',
      client_ip: '203.0.113.7',
      method: 'GET',
      host: 'hairdesign.example.com',
      uri: '/start?utm_source=ig',
      headers: { 'User-Agent': [CHROME], Referer: ['https://l.instagram.com/'] },
      ...request,
    },
    status: 200,
    size: 5120,
    duration: 0.0042,
    resp_headers: { 'Content-Type': ['text/html; charset=utf-8'] },
    ...rest,
  });
}

describe('CaddyLogParser', () => {
  const parser = new CaddyLogParser('access.log');

  test('parses a Caddy JSON access log line', () => {
    const entry = parser.parseLine(line());
    expect(entry).not.toBeNull();
    expect(entry.timestamp.toISOString()).toBe('2025-10-06T11:26:40.500Z');
    expect(entry.ip).toBe('203.0.113.7');
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/start');
    expect(entry.status).toBe(200);
    expect(entry.bytes).toBe(5120);
    expect(entry.referrer).toBe('https://l.instagram.com/');
    expect(entry.userAgent).toBe(CHROME);
    expect(entry.host).toBe('hairdesign.example.com');
    expect(parser.isPageview(entry)).toBe(true);
  });

  test('accepts string timestamps and falls back to remote_ip', () => {
    const entry = parser.parseLine(line({ ts: '2026-10-06T12:00:00Z', request: { client_ip: undefined } }));
    expect(entry.timestamp.toISOString()).toBe('2026-10-06T12:00:00.000Z');
    expect(entry.ip).toBe('172.68.1.10');
  });

  test('reads the visitor IP from a configured proxy header', () => {
    const behindCf = new CaddyLogParser('access.log', 0, { clientIpHeader: 'Cf-Connecting-Ip' });
    const entry = behindCf.parseLine(line({ request: { headers: { 'User-Agent': [CHROME], 'Cf-Connecting-Ip': ['198.51.100.4'] } } }));
    expect(entry.ip).toBe('198.51.100.4');
  });

  test('skips blank, malformed, and non-access lines', () => {
    expect(parser.parseLine('')).toBeNull();
    expect(parser.parseLine('not json')).toBeNull();
    expect(parser.parseLine(JSON.stringify({ level: 'info', msg: 'server running' }))).toBeNull();
    expect(parser.parseLine(line({ ts: 'garbage' }))).toBeNull();
  });

  test('does not count assets, API JSON, or Next.js background requests', () => {
    const asset = parser.parseLine(line({ request: { uri: '/_next/static/chunks/app.js' }, resp_headers: { 'Content-Type': ['application/javascript'] } }));
    const api = parser.parseLine(line({ request: { uri: '/api/beacon', method: 'POST' }, resp_headers: { 'Content-Type': ['application/json'] } }));
    const rsc = parser.parseLine(line({ request: { uri: '/faq?_rsc=abc', headers: { 'User-Agent': [CHROME], Rsc: ['1'] } }, resp_headers: { 'Content-Type': ['text/x-component'] } }));
    const prefetch = parser.parseLine(line({ request: { headers: { 'User-Agent': [CHROME], 'Sec-Purpose': ['prefetch'] } } }));
    for (const entry of [asset, api, rsc, prefetch]) {
      expect(entry).not.toBeNull();
      expect(parser.isPageview(entry)).toBe(false);
    }
  });

  test('does not count bots or other hosts', () => {
    const scoped = new CaddyLogParser('access.log', 0, { hosts: ['studio.example.com'] });
    expect(scoped.isPageview(scoped.parseLine(line()))).toBe(false);
    const bot = parser.parseLine(line({ request: { headers: { 'User-Agent': ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'] } } }));
    expect(parser.isPageview(bot)).toBe(false);
  });

  test('collapses private path segments', () => {
    const p = new CaddyLogParser('access.log', 0, { collapsePrefixes: ['/r/'] });
    expect(p.parseLine(line({ request: { uri: '/r/pYTxLyl1em53jf/review' } })).path).toBe('/r/:token');
    expect(p.parseLine(line({ request: { uri: '/r/' } })).path).toBe('/r/');
    expect(p.parseLine(line({ request: { uri: '/about' } })).path).toBe('/about');
  });
});

describe('isLikelyBot', () => {
  test('keeps browsers, flags crawlers and scripts', () => {
    expect(isLikelyBot(CHROME)).toBe(false);
    expect(isLikelyBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36')).toBe(false);
    for (const ua of ['', '-', 'curl/8.7.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'facebookexternalhit/1.1', 'python-requests/2.32', 'Mozilla/5.0 HeadlessChrome/141.0', 'masko-sites-check']) {
      expect(isLikelyBot(ua)).toBe(true);
    }
  });
});

describe('nginx timestamps', () => {
  test('are independent of the server timezone', () => {
    const p = new NginxLogParser('access.log');
    expect(p.parseTimestamp('[04/Jan/2026:12:00:00 +0000]').toISOString()).toBe('2026-01-04T12:00:00.000Z');
    expect(p.parseTimestamp('[04/Jan/2026:12:00:00 +0200]').toISOString()).toBe('2026-01-04T10:00:00.000Z');
    expect(p.parseTimestamp('[04/Jan/2026:12:00:00 -0530]').toISOString()).toBe('2026-01-04T17:30:00.000Z');
  });
});
