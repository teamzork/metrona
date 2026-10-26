const fs = require('fs');
const os = require('os');
const path = require('path');
const { siteStatus } = require('./status');
const { loadEnvFile } = require('./common');

describe('metrona status', () => {
  let dir;
  const site = (logPath) => ({ siteId: 'a', domain: 'a.com', logPath });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrona-status-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const writeNumbers = (generatedAt) =>
    fs.writeFileSync(path.join(dir, 'a.yaml'), `metadata:\n  generated_at: '${generatedAt}'\nsummary:\n  total_pageviews: 12\n  unique_visitors: 5\n`);

  test('a readable log and fresh numbers are fine', () => {
    const log = path.join(dir, 'a.log');
    fs.writeFileSync(log, 'x\n');
    writeNumbers(new Date().toISOString());
    const r = siteStatus(site(log), dir);
    expect(r.problems).toEqual([]);
    expect(r.numbers).toMatchObject({ pageviews: 12, visitors: 5 });
  });

  test('says when the log is missing and when there are no numbers yet', () => {
    const r = siteStatus(site(path.join(dir, 'missing.log')), dir);
    expect(r.problems.join('\n')).toMatch(/is missing/);
    expect(r.problems.join('\n')).toMatch(/no numbers yet/);
  });

  test('says when the numbers are stale', () => {
    const log = path.join(dir, 'a.log');
    fs.writeFileSync(log, 'x\n');
    writeNumbers(new Date(Date.now() - 5 * 3600 * 1000).toISOString());
    expect(siteStatus(site(log), dir).problems.join('\n')).toMatch(/is the scheduler running/);
  });
});

describe('loadEnvFile', () => {
  test('reads KEY=VALUE lines without overriding the environment', () => {
    const file = path.join(os.tmpdir(), `metrona-env-${process.pid}`);
    fs.writeFileSync(file, '# comment\nMETRONA_TEST_A=one\nMETRONA_TEST_B="two"\n');
    process.env.METRONA_TEST_A = 'kept';
    expect(loadEnvFile(file)).toBe(true);
    expect([process.env.METRONA_TEST_A, process.env.METRONA_TEST_B]).toEqual(['kept', 'two']);
    expect(loadEnvFile('/nonexistent/metrona.env')).toBe(false);
    fs.rmSync(file);
    delete process.env.METRONA_TEST_A;
    delete process.env.METRONA_TEST_B;
  });
});
