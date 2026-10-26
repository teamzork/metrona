/**
 * @fileoverview One site's page, in two tabs: Summary (what happened, in words, with three short
 * cards) and Report (the figures: a strip of numbers, a calendar, and tables). The same HTML serves
 * the live dashboard and the static pages, so it is rendered here from the site's dashboard file;
 * public/site.js only switches tabs, expands lists and builds the CSV downloads.
 *
 * Design: design-explorations/site-dashboard.html, variants A (Summary) and D (Report).
 */

const DAY = 86400000;

/** Where a visit came from, by referring domain. Anything not listed is "other sites". */
const SEARCH = ['bing.com', 'duckduckgo.com', 'yahoo.com', 'search.yahoo.com', 'yandex.ru', 'yandex.com', 'ya.ru', 'baidu.com', 'ecosia.org', 'startpage.com', 'search.brave.com', 'kagi.com', 'qwant.com', 'naver.com', 'perplexity.ai', 'chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com'];
const SOCIAL = ['facebook.com', 'fb.com', 'instagram.com', 't.co', 'twitter.com', 'x.com', 'linkedin.com', 'lnkd.in', 'reddit.com', 't.me', 'telegram.org', 'vk.com', 'youtube.com', 'youtu.be', 'pinterest.com', 'tiktok.com', 'threads.net', 'bsky.app', 'mastodon.social', 'news.ycombinator.com', 'tumblr.com', 'whatsapp.com', 'discord.com', 'medium.com'];

function matches(domain, list) {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return list.some((entry) => d === entry || d.endsWith(`.${entry}`));
}

/** "search", "social" or "other" */
function referrerKind(domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (/(^|\.)google\.[a-z.]+$/.test(d) && !d.startsWith('mail.') && !d.startsWith('docs.')) return 'search';
  if (matches(d, SEARCH)) return 'search';
  if (matches(d, SOCIAL)) return 'social';
  return 'other';
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (date) => Date.parse(`${date}T00:00:00Z`);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function shortDate(date, withYear = false) {
  return new Date(dayMs(date)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}) });
}

function longDate(date) {
  return `${WEEKDAYS[new Date(dayMs(date)).getUTCDay()]}, ${shortDate(date)}`;
}

/**
 * Everything the page shows, worked out once from the dashboard file (`<siteId>.yaml`).
 * @param {Object} data - The dashboard file's contents
 * @param {Object} [site] - { siteId, name, domain } from the config, preferred over the file's
 * @param {Object} [options]
 * @param {number} [options.now=Date.now()]
 */
function buildView(data, site = {}, { now = Date.now() } = {}) {
  const meta = (data && data.metadata) || {};
  const summary = (data && data.summary) || {};
  const pages = ((data && data.top_pages) || []).map((p) => ({ path: p.path, pageviews: p.pageviews || 0, visitors: p.unique_visitors || 0 }));
  const referrers = ((data && data.referrers && data.referrers.by_domain) || []).map((r) => ({ domain: r.domain, visits: r.visits || 0, visitors: r.unique_visitors || 0, kind: referrerKind(r.domain) }));
  const daily = ((data && data.time_series && data.time_series.daily) || [])
    .map((d) => ({ date: String(d.date).slice(0, 10), pageviews: d.pageviews || 0, visitors: d.unique_visitors || 0 }))
    .filter((d) => !Number.isNaN(dayMs(d.date)))
    .sort((a, b) => a.date.localeCompare(b.date));

  const pageviews = summary.total_pageviews || 0;
  const visitors = summary.unique_visitors || 0;
  const referralVisits = referrers.reduce((sum, r) => sum + r.visits, 0);
  // Older files have no direct count: it is what no referrer accounts for.
  const direct = Number.isFinite(summary.direct_traffic) && (summary.direct_traffic > 0 || summary.referral_traffic > 0)
    ? summary.direct_traffic
    : Math.max(0, pageviews - referralVisits);
  const kinds = { search: 0, social: 0, other: 0 };
  for (const r of referrers) kinds[r.kind] += r.visits;

  const latest = daily[daily.length - 1] || null;
  const previous = daily[daily.length - 2] || null;
  const isToday = Boolean(latest) && latest.date === iso(now);
  const byDate = new Map(daily.map((d) => [d.date, d]));

  // This week against the week before: the 7 days ending on the newest day, and the 7 before them.
  let week = null;
  let weekStarts = null;
  if (latest) {
    const end = dayMs(latest.date);
    const first = dayMs(daily[0].date);
    if (end - first >= 13 * DAY) {
      const sum = (from, to) => daily.filter((d) => dayMs(d.date) > from && dayMs(d.date) <= to).reduce((s, d) => s + d.pageviews, 0);
      const current = sum(end - 7 * DAY, end);
      const prior = sum(end - 14 * DAY, end - 7 * DAY);
      week = { current, prior, change: prior > 0 ? (current - prior) / prior : null };
    } else {
      weekStarts = iso(first + 13 * DAY);
    }
  }

  const best = daily.reduce((top, d) => (!top || d.pageviews > top.pageviews ? d : top), null);

  // The calendar: the last five whole weeks (Monday first), ending with the newest day's week.
  const calendar = [];
  if (latest) {
    const end = dayMs(latest.date);
    const mondayOffset = (new Date(end).getUTCDay() + 6) % 7;
    const start = end - mondayOffset * DAY - 28 * DAY;
    const counts = daily.map((d) => d.pageviews);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    for (let t = start; t < start + 35 * DAY; t += DAY) {
      const date = iso(t);
      const day = byDate.get(date);
      // Under a week, shades would only rank two or three days against each other: one shade.
      const level = !day ? null : max === min || daily.length < 7 ? 3 : Math.min(4, Math.floor(((day.pageviews - min) / (max - min)) * 5));
      calendar.push({ date, day: Number(date.slice(8)), pageviews: day ? day.pageviews : null, level, future: t > end });
    }
  }

  return {
    siteId: site.siteId || meta.site_id,
    name: site.name || meta.site_name || site.domain || meta.domain || meta.site_id,
    domain: site.domain || meta.domain || null,
    updated: meta.generated_at || null,
    period: { start: daily[0] ? daily[0].date : null, end: latest ? latest.date : null, days: daily.length },
    pageviews,
    visitors,
    perVisitor: visitors > 0 ? pageviews / visitors : null,
    direct,
    kinds,
    referralVisits,
    pages,
    referrers,
    daily,
    latest,
    previous,
    isToday,
    week,
    weekStarts,
    best,
    calendar,
  };
}

const n = (value) => Number(value || 0).toLocaleString('en-US');
const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
const esc = (text) => String(text == null ? '' : text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The opening sentences of the Summary tab. */
function headline(v) {
  if (!v.latest) return 'No visits counted yet. Metrona updates every hour; the first numbers appear after the next run.';
  const when = v.isToday ? 'today' : `on ${longDate(v.latest.date)}`;
  const parts = [`<b>${n(v.latest.pageviews)} pageviews ${when}</b> from ${n(v.latest.visitors)} ${v.latest.visitors === 1 ? 'person' : 'people'}.`];
  if (v.week) {
    const { current, change } = v.week;
    if (change === null) parts.push(`This week had <b>${n(current)} pageviews</b>.`);
    else if (Math.abs(change) < 0.1) parts.push(`This week is <b>about the same as last week</b> (${n(current)} pageviews, ${Math.abs(Math.round(change * 100))}% ${change < 0 ? 'fewer' : 'more'}).`);
    else parts.push(`This week is <b>${change > 0 ? 'up' : 'down'} ${Math.abs(Math.round(change * 100))}% on last week</b> (${n(current)} pageviews).`);
  } else if (v.weekStarts) {
    parts.push(`Metrona has counted ${v.period.days} ${v.period.days === 1 ? 'day' : 'days'} so far; comparisons with the week before start on ${shortDate(v.weekStarts)}.`);
  }
  if (v.best && v.period.days > 1) parts.push(`The busiest day so far was ${longDate(v.best.date)}.`);
  return parts.join(' ');
}

function sparkline(daily) {
  const W = 300;
  const H = 56;
  if (daily.length < 2) return `<div class="mtr-spark-empty">One day so far: the line starts tomorrow.</div>`;
  const max = Math.max(...daily.map((d) => d.pageviews)) * 1.08 || 1;
  const pts = daily.map((d, i) => [4 + (i * (W - 8)) / (daily.length - 1), H - 4 - (d.pageviews / max) * (H - 8)]);
  const line = `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}`;
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  return `<svg class="mtr-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Pageviews per day, ${shortDate(daily[0].date)} to ${shortDate(daily[daily.length - 1].date)}"><path d="${area}" class="mtr-spark-area"/><path d="${line}" class="mtr-spark-line"/></svg>`;
}

function listRows(rows, label, value, limit, cls) {
  return rows
    .map((r, i) => `<li${i >= limit ? ' class="mtr-more-row" hidden' : ''}><span class="${cls}">${esc(label(r))}</span><span class="mtr-num">${n(value(r))}</span></li>`)
    .join('');
}

function moreButton(count, limit, noun) {
  return count > limit ? `<button type="button" class="mtr-link" data-expand>All ${count} ${noun} →</button>` : '';
}

function summaryTab(v) {
  const periodLabel = v.period.days ? `Last ${v.period.days} ${v.period.days === 1 ? 'day' : 'days'} of logs` : 'So far';
  const total = v.direct + v.referralVisits;
  const seg = (part) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0');
  return `
    <p class="mtr-lede">${headline(v)}</p>
    <div class="mtr-cards">
      <section class="mtr-card">
        <div class="mtr-kicker">${esc(periodLabel)}</div>
        <div class="mtr-big">${n(v.pageviews)}</div>
        <div class="mtr-sub">pageviews from <b>${n(v.visitors)}</b> ${v.visitors === 1 ? 'visitor' : 'visitors'}</div>
        ${sparkline(v.daily)}
        ${v.daily.length > 1 ? `<div class="mtr-axis"><span>${shortDate(v.daily[0].date)}</span><span>${shortDate(v.daily[v.daily.length - 1].date)}</span></div>` : ''}
      </section>
      <section class="mtr-card" data-list>
        <h3>What people read</h3>
        ${v.pages.length ? `<ol class="mtr-list">${listRows(v.pages, (p) => p.path, (p) => p.pageviews, 5, 'mtr-path')}</ol>${moreButton(v.pages.length, 5, 'pages')}` : '<p class="mtr-empty">No pages viewed yet.</p>'}
      </section>
      <section class="mtr-card" data-list>
        <h3>How they found you</h3>
        <div class="mtr-split" role="img" aria-label="Direct ${pct(v.direct, total)}, search ${pct(v.kinds.search, total)}, social media ${pct(v.kinds.social, total)}, other sites ${pct(v.kinds.other, total)}">
          <i class="k-direct" style="width:${seg(v.direct)}"></i><i class="k-search" style="width:${seg(v.kinds.search)}"></i><i class="k-social" style="width:${seg(v.kinds.social)}"></i><i class="k-other" style="width:${seg(v.kinds.other)}"></i>
        </div>
        <ul class="mtr-key">
          <li><i class="k-direct"></i>Came directly<b>${pct(v.direct, total)}</b></li>
          <li><i class="k-search"></i>Search<b>${pct(v.kinds.search, total)}</b></li>
          <li><i class="k-social"></i>Social media<b>${pct(v.kinds.social, total)}</b></li>
          <li><i class="k-other"></i>Other sites<b>${pct(v.kinds.other, total)}</b></li>
        </ul>
        ${v.referrers.length ? `<ol class="mtr-list">${listRows(v.referrers, (r) => r.domain, (r) => r.visits, 4, '')}</ol>${moreButton(v.referrers.length, 4, 'sites')}` : '<p class="mtr-empty">No visits from other sites yet: everyone came directly.</p>'}
      </section>
    </div>`;
}

function reportTab(v) {
  const vsYesterday = v.latest && v.previous && v.previous.pageviews > 0 ? (v.latest.pageviews - v.previous.pageviews) / v.previous.pageviews : null;
  const change = vsYesterday === null ? '' : ` <em class="${vsYesterday < 0 ? 'down' : 'up'}">${vsYesterday > 0 ? '+' : '−'}${Math.abs(Math.round(vsYesterday * 100))}%</em>`;
  const cells = v.calendar
    .map((c) => (c.pageviews === null
      ? `<i class="mtr-cal-c mtr-cal-none${c.future ? ' mtr-cal-future' : ''}"><span>${c.day}</span></i>`
      : `<i class="mtr-cal-c l${c.level}" title="${shortDate(c.date)}: ${n(c.pageviews)} pageviews"><span>${c.day}</span></i>`))
    .join('');
  // Bars are scaled to the top row, as in a ranked list; the number beside them is the share.
  const table = (rows, name, value, visitors, total, cls) => {
    const top = Math.max(1, ...rows.map(value));
    return rows
      .map((r, i) => `<tr${i >= 10 ? ' class="mtr-more-row" hidden' : ''}><td class="mtr-name ${cls}" title="${esc(name(r))}">${esc(name(r))}</td><td>${n(value(r))}</td><td>${n(visitors(r))}</td><td class="mtr-share"><span><i style="width:${Math.min(100, Math.round((value(r) / top) * 100))}%"></i></span>${total ? Math.min(100, (value(r) / total) * 100).toFixed(1) : '0.0'}%</td></tr>`)
      .join('');
  };
  const latestLabel = v.latest ? (v.isToday ? 'Today' : shortDate(v.latest.date)) : 'Latest day';
  return `
    <div class="mtr-strip">
      <div><small>Pageviews</small><b>${n(v.pageviews)}</b></div>
      <div><small>Visitors</small><b>${n(v.visitors)}</b></div>
      <div><small>Per visitor</small><b>${v.perVisitor ? v.perVisitor.toFixed(2) : '—'}</b></div>
      <div><small>Came directly</small><b>${pct(v.direct, v.direct + v.referralVisits)}</b></div>
      <div><small>Best day</small><b>${v.best ? `${shortDate(v.best.date)} · ${n(v.best.pageviews)}` : '—'}</b></div>
      <div><small>${esc(latestLabel)}</small><b>${v.latest ? n(v.latest.pageviews) : '—'}${change}</b></div>
    </div>
    <div class="mtr-report">
      <section class="mtr-panel mtr-cal">
        <div class="mtr-h">Pageviews by day</div>
        ${v.calendar.length ? `<div class="mtr-cal-wd"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="mtr-cal-grid">${cells}</div><div class="mtr-cal-scale">fewer <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> more</div>` : '<p class="mtr-empty">The calendar fills in as days are counted.</p>'}
        ${v.daily.length && v.daily.length < 7 ? `<p class="mtr-note">${v.period.days} ${v.period.days === 1 ? 'day' : 'days'} counted so far.</p>` : ''}
      </section>
      <section class="mtr-panel" data-list>
        <div class="mtr-h">Top pages <button type="button" class="mtr-link" data-csv="pages">CSV</button></div>
        <table><thead><tr><th>Page</th><th>Views</th><th>Visitors</th><th>Share</th></tr></thead><tbody>${table(v.pages, (p) => p.path, (p) => p.pageviews, (p) => p.visitors, v.pageviews, 'mtr-path')}</tbody></table>
        ${moreButton(v.pages.length, 10, 'pages')}
      </section>
      <section class="mtr-panel" data-list>
        <div class="mtr-h">Referrers <button type="button" class="mtr-link" data-csv="referrers">CSV</button></div>
        <table><thead><tr><th>Site</th><th>Visits</th><th>Visitors</th><th>Share</th></tr></thead><tbody>${table(v.referrers, (r) => r.domain, (r) => r.visits, (r) => r.visitors, v.referralVisits, '')}</tbody></table>
        ${moreButton(v.referrers.length, 10, 'sites')}
      </section>
    </div>`;
}

function updatedText(updated, now) {
  if (!updated) return 'Not updated yet';
  const t = Date.parse(updated);
  if (Number.isNaN(t)) return 'Not updated yet';
  const minutes = Math.round((now - t) / 60000);
  if (minutes < 2) return 'Updated just now';
  if (minutes < 90) return `Updated ${minutes} min ago`;
  if (minutes < 48 * 60) return `Updated ${Math.round(minutes / 60)} h ago`;
  return `Updated ${shortDate(iso(t), true)}`;
}

/**
 * The whole page.
 * @param {Object} view - From buildView
 * @param {Object} [options]
 * @param {string} [options.assetBase='/static'] - Where site.css and site.js are served
 * @param {string|null} [options.backHref] - Link back to the list of sites; none when there's one site
 * @param {boolean} [options.logout=false] - Show the sign-out button (live dashboard with a login)
 * @param {number} [options.now=Date.now()]
 */
function renderSitePage(view, { assetBase = '/static', backHref = null, logout = false, now = Date.now() } = {}) {
  const periodText = view.period.start
    ? `Pages, referrers and visitors cover ${view.period.start === view.period.end ? shortDate(view.period.start, true) : `${shortDate(view.period.start)} – ${shortDate(view.period.end, true)}`}, the logs kept on the server. Days are UTC.`
    : '';
  const data = {
    site: view.siteId,
    domain: view.domain,
    summary: { pageviews: view.pageviews, visitors: view.visitors, direct: view.direct, period: view.period, updated: view.updated },
    pages: view.pages,
    referrers: view.referrers,
    daily: view.daily,
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(view.domain || view.name)} · Metrona</title>
<link rel="stylesheet" href="${esc(assetBase)}/site.css">
</head>
<body>
<div class="mtr">
  <header class="mtr-top">
    <div>
      ${backHref ? `<a class="mtr-back" href="${esc(backHref)}">← All sites</a>` : ''}
      <h1 class="mtr-site">${esc(view.domain || view.name)}</h1>
      <div class="mtr-updated"${view.updated ? ` data-updated="${esc(view.updated)}"` : ''}>${esc(updatedText(view.updated, now))}</div>
    </div>
    ${logout ? '<button type="button" class="mtr-btn" data-logout>Sign out</button>' : ''}
  </header>
  <nav class="mtr-tabs" role="tablist" aria-label="Views">
    <button type="button" role="tab" id="tab-summary" aria-controls="panel-summary" aria-selected="true">Summary</button>
    <button type="button" role="tab" id="tab-report" aria-controls="panel-report" aria-selected="false" tabindex="-1">Report</button>
  </nav>
  <main>
    <section id="panel-summary" role="tabpanel" aria-labelledby="tab-summary">${summaryTab(view)}</section>
    <section id="panel-report" role="tabpanel" aria-labelledby="tab-report" hidden>${reportTab(view)}</section>
  </main>
  <footer class="mtr-foot">
    <p>Download as a spreadsheet: <button type="button" class="mtr-link" data-csv="summary">Summary</button> · <button type="button" class="mtr-link" data-csv="pages">Pages</button> · <button type="button" class="mtr-link" data-csv="referrers">Referrers</button> · <button type="button" class="mtr-link" data-csv="days">Days</button></p>
    <p class="mtr-fine">${esc(periodText)} Counted by <a href="https://github.com/teamzork/metrona">Metrona</a> from the server's access logs: no cookies, no tracking script.</p>
  </footer>
</div>
<script type="application/json" id="metrona-data">${json}</script>
<script src="${esc(assetBase)}/site.js" defer></script>
</body>
</html>`;
}

module.exports = { buildView, renderSitePage, referrerKind, headline };
