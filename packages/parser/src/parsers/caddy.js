/**
 * @fileoverview Caddy v2 JSON access log parser
 *
 * Reads the structured access log Caddy writes with `log { format json }`, one JSON object per
 * line:
 *
 *   {"ts":1759750000.123,"request":{"remote_ip":"…","client_ip":"…","method":"GET","host":"…",
 *    "uri":"/path?q","headers":{"User-Agent":["…"],"Referer":["…"]}},"status":200,"size":1234,
 *    "duration":0.004,"resp_headers":{"Content-Type":["text/html; charset=utf-8"]}}
 *
 * Unlike the nginx combined format it carries the response Content-Type and request headers, so
 * pageviews can be told apart from assets, API calls, and the background requests single-page
 * apps make (Next.js RSC fetches and prefetches).
 */

const BaseParser = require('./base');
const { LogEntry } = require('./nginx');
const { isLikelyBot } = require('../utils/bot-filter');

/** First value of a Caddy header field (Caddy logs header values as arrays). Case-insensitive. */
function header(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) {
      const value = headers[key];
      return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
    }
  }
  return '';
}

/** Caddy's `ts` is Unix seconds (float) by default, or a string with another `time_format`. */
function parseTs(ts) {
  if (typeof ts === 'number' && Number.isFinite(ts)) return new Date(ts * 1000);
  if (typeof ts === 'string' && ts) {
    const asNumber = Number(ts);
    const date = Number.isFinite(asNumber) ? new Date(asNumber * 1000) : new Date(ts);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

class CaddyLogParser extends BaseParser {
  /**
   * @param {string} logPath - Path to the Caddy access log
   * @param {number} [lastPosition=0] - Last known position in the file
   * @param {Object} [options]
   * @param {string} [options.clientIpHeader] - Take the visitor IP from this request header (e.g.
   *   `Cf-Connecting-Ip` behind Cloudflare). Only set it for hosts that are always proxied, since
   *   anyone can send the header to a host that isn't.
   * @param {string[]} [options.collapsePrefixes] - Path prefixes whose remainder is private (e.g.
   *   `/r/` for tokenised links): `/r/abc123/pdf` is recorded as `/r/:token`.
   * @param {string[]} [options.hosts] - Only count requests for these Host values (empty = all).
   */
  constructor(logPath, lastPosition = 0, options = {}) {
    super(logPath, lastPosition);
    this.clientIpHeader = options.clientIpHeader || '';
    this.collapsePrefixes = (options.collapsePrefixes || []).filter(Boolean);
    this.hosts = (options.hosts || []).map((h) => String(h).toLowerCase());
  }

  /**
   * @param {string} line - One JSON log line
   * @returns {LogEntry|null} The entry, or null for blank, malformed, or non-access lines
   */
  parseLine(line) {
    if (!line || line.trim() === '') return null;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return null;
    }
    const req = record && record.request;
    if (!req || typeof req !== 'object') return null;

    const timestamp = parseTs(record.ts);
    if (!timestamp) return null;

    const host = String(req.host || '').toLowerCase().replace(/:\d+$/, '');
    const headers = req.headers || {};
    const ip = (this.clientIpHeader && header(headers, this.clientIpHeader).split(',')[0].trim()) || req.client_ip || req.remote_ip || '';
    const { method, path } = this.parseRequest(`${req.method || 'GET'} ${req.uri || '/'}`);

    const entry = new LogEntry({
      timestamp,
      ip,
      method,
      path: this.collapsePath(path),
      status: parseInt(record.status) || 0,
      bytes: parseInt(record.size) || 0,
      referrer: header(headers, 'Referer'),
      userAgent: header(headers, 'User-Agent'),
      responseTime: typeof record.duration === 'number' ? record.duration : 0,
    });
    entry.host = host;
    entry.contentType = header(record.resp_headers, 'Content-Type').toLowerCase();
    entry.background = Boolean(
      header(headers, 'Rsc') || header(headers, 'Next-Router-Prefetch') || header(headers, 'Next-Action') ||
      /prefetch|prerender/i.test(header(headers, 'Sec-Purpose') || header(headers, 'Purpose'))
    );
    return entry;
  }

  /** `/r/abc/pdf` → `/r/:token` for each configured prefix. */
  collapsePath(path) {
    for (const prefix of this.collapsePrefixes) {
      if (path.startsWith(prefix) && path.length > prefix.length) return `${prefix}:token`;
    }
    return path;
  }

  /**
   * A pageview: the base rules (status, method, no asset extension), plus an HTML response, not a
   * background request, not a bot, and (when `hosts` is set) for one of the site's hosts.
   */
  isPageview(entry) {
    if (!super.isPageview(entry)) return false;
    if (entry.contentType && !entry.contentType.startsWith('text/html')) return false;
    if (entry.background) return false;
    if (isLikelyBot(entry.userAgent)) return false;
    if (this.hosts.length && entry.host && !this.hosts.includes(entry.host)) return false;
    return true;
  }

  parseLines(lines) {
    return lines.map((l) => this.parseLine(l)).filter(Boolean);
  }

  static getSupportedFormats() {
    return ['caddy'];
  }
}

module.exports = { CaddyLogParser };
