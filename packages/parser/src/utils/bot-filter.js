/**
 * @fileoverview Recognises crawlers, monitors, and scripted clients by their user agent, so they
 * don't count as visitors. A heuristic: it errs towards keeping real browsers.
 */

const BOT_PATTERN = new RegExp(
  [
    'bot\\b', 'bot/', 'crawl', 'spider', 'slurp', 'mediapartners', 'facebookexternalhit', 'embedly',
    'preview', 'monitor', 'uptime', 'pingdom', 'headless', 'phantomjs', 'lighthouse', 'pagespeed',
    'curl/', 'wget/', 'python-requests', 'python-urllib', 'aiohttp', 'httpx', 'go-http-client',
    'okhttp', 'java/', 'libwww', 'node-fetch', 'undici', 'axios/', 'scrapy', 'feedfetcher', 'rss',
    'masko-sites-check',
  ].join('|'),
  'i'
);

/**
 * @param {string} userAgent
 * @returns {boolean} True for empty user agents and known automated clients
 */
function isLikelyBot(userAgent) {
  if (!userAgent || userAgent === '-') return true;
  return BOT_PATTERN.test(userAgent);
}

module.exports = { isLikelyBot };
