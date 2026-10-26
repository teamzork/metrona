const { buildView, renderSitePage, referrerKind, headline } = require('./site-view');

const NOW = Date.parse('2026-10-27T12:00:00Z');

/** n days ending on 2026-10-27, pageviews from the function */
function days(n, pageviews = (i) => 100 + i, end = '2026-10-27') {
  const last = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(last - (n - 1 - i) * 86400000).toISOString().slice(0, 10);
    return { date, pageviews: pageviews(i), unique_visitors: Math.round(pageviews(i) / 2) };
  });
}

function file(overrides = {}) {
  return {
    metadata: { site_id: 'example-com', domain: 'example.com', generated_at: '2026-10-27T11:00:00Z' },
    summary: { total_pageviews: 1000, unique_visitors: 400 },
    top_pages: [{ path: '/', pageviews: 600, unique_visitors: 300 }, { path: '/blog', pageviews: 400, unique_visitors: 150 }],
    referrers: { by_domain: [{ domain: 'www.google.com', visits: 300, unique_visitors: 200 }, { domain: 'l.instagram.com', visits: 100, unique_visitors: 90 }, { domain: 'example.org', visits: 50, unique_visitors: 40 }] },
    time_series: { daily: days(20) },
    ...overrides,
  };
}

describe('referrerKind', () => {
  test.each([
    ['www.google.com', 'search'], ['google.co.uk', 'search'], ['duckduckgo.com', 'search'], ['chatgpt.com', 'search'],
    ['l.instagram.com', 'social'], ['t.co', 'social'], ['news.ycombinator.com', 'social'], ['m.facebook.com', 'social'],
    ['mail.google.com', 'other'], ['example.org', 'other'], ['notfacebook.com', 'other'],
  ])('%s is %s', (domain, kind) => expect(referrerKind(domain)).toBe(kind));
});

describe('buildView', () => {
  test('works out direct visits when the file has no count, and sorts referrers into kinds', () => {
    const v = buildView(file(), {}, { now: NOW });
    expect(v.direct).toBe(1000 - 450);
    expect(v.kinds).toEqual({ search: 300, social: 100, other: 50 });
    expect(v.perVisitor).toBeCloseTo(2.5);
  });

  test("uses the file's direct count when it has one", () => {
    const v = buildView(file({ summary: { total_pageviews: 1000, unique_visitors: 400, direct_traffic: 700, referral_traffic: 300 } }), {}, { now: NOW });
    expect(v.direct).toBe(700);
  });

  test('compares the last 7 days with the 7 before, once there are 14 days', () => {
    const v = buildView(file({ time_series: { daily: days(14, (i) => (i < 7 ? 100 : 120)) } }), {}, { now: NOW });
    expect(v.week).toEqual({ current: 840, prior: 700, change: 0.2 });
    expect(headline(v)).toContain('up 20% on last week');
  });

  test('says when the comparison starts, for a young site', () => {
    const v = buildView(file({ time_series: { daily: days(2) } }), {}, { now: NOW });
    expect(v.week).toBeNull();
    expect(v.weekStarts).toBe('2026-11-08');
    expect(headline(v)).toMatch(/counted 2 days so far; comparisons with the week before start on Nov 8/);
  });

  test('"about the same" within 10%', () => {
    const v = buildView(file({ time_series: { daily: days(14, (i) => (i < 7 ? 100 : 95)) } }), {}, { now: NOW });
    expect(headline(v)).toContain('about the same as last week');
    expect(headline(v)).toContain('5% fewer');
  });

  test('names the day when the newest day is not today', () => {
    const v = buildView(file({ time_series: { daily: days(3, () => 10, '2026-10-25') } }), {}, { now: NOW });
    expect(v.isToday).toBe(false);
    expect(headline(v)).toContain('on Sunday, Oct 25');
  });

  test('the calendar is five Monday-first weeks ending with the newest day’s week', () => {
    const v = buildView(file({ time_series: { daily: days(3) } }), {}, { now: NOW });
    expect(v.calendar).toHaveLength(35);
    expect(new Date(`${v.calendar[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
    const counted = v.calendar.filter((c) => c.pageviews !== null);
    expect(counted.map((c) => c.date)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27']);
    expect(v.calendar.filter((c) => c.future).length).toBe(5);
  });

  test('an empty file still gives a complete view', () => {
    const v = buildView({}, { siteId: 'new', domain: 'new.example.com' }, { now: NOW });
    expect(v).toMatchObject({ pageviews: 0, visitors: 0, direct: 0, latest: null, calendar: [] });
    expect(headline(v)).toMatch(/No visits counted yet/);
  });
});

describe('renderSitePage', () => {
  test('two tabs, the data for downloads, and the assets', () => {
    const html = renderSitePage(buildView(file(), {}, { now: NOW }), { assetBase: 'assets', now: NOW });
    expect(html).toContain('id="tab-summary"');
    expect(html).toContain('id="panel-report" role="tabpanel" aria-labelledby="tab-report" hidden');
    expect(html).toContain('<link rel="stylesheet" href="assets/site.css">');
    expect(html).toContain('Updated 60 min ago');
    expect(html).not.toContain('← All sites');
    const data = JSON.parse(/id="metrona-data">(.*?)<\/script>/s.exec(html)[1]);
    expect(data.pages).toHaveLength(2);
    expect(data.referrers[0].kind).toBe('search');
  });

  test("a visitor's path or referrer can't add markup or end the data block", () => {
    const evil = file({
      top_pages: [{ path: '/<img src=x onerror=alert(1)>', pageviews: 5, unique_visitors: 1 }, { path: '/</script><script>alert(2)</script>', pageviews: 4, unique_visitors: 1 }],
      referrers: { by_domain: [{ domain: '"><svg onload=alert(3)>', visits: 3, unique_visitors: 1 }] },
    });
    const html = renderSitePage(buildView(evil, {}, { now: NOW }), { now: NOW });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<svg onload');
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  test('a link back to all sites and a sign-out button when asked', () => {
    const html = renderSitePage(buildView(file(), {}, { now: NOW }), { backHref: '/', logout: true, now: NOW });
    expect(html).toContain('<a class="mtr-back" href="/">← All sites</a>');
    expect(html).toContain('data-logout');
  });
});
