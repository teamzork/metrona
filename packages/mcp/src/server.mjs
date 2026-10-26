/**
 * @fileoverview Metrona's MCP server: read-only questions about the sites Metrona counts.
 *
 * It reads the same `<siteId>.yaml` files the dashboard reads (the scheduler writes them hourly),
 * so it needs no dashboard, login or network — run it over stdio, locally or through SSH:
 *
 *   claude mcp add metrona -- ssh myserver metrona mcp
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const DEFAULT_DATA_DIR = '/var/lib/metrona/dashboard';

const INSTRUCTIONS = `Metrona counts website traffic from web server access logs: pageviews by people (bots, assets, errors and background requests are left out) and unique visitors (a salted hash of IP address and browser; no IPs are stored). The scheduler updates the numbers once an hour.

What each number covers:
- list_sites and get_top: the log files still on the server, usually the last 2-30 days (the "period" field says which). Top pages and referrers exist only for that whole window, not per day, so they can't show change over time on their own.
- get_daily_trend: one row per UTC day, kept long after the log files are rotated away. Use it for anything over time. Visitors in it are per day; adding days together counts a returning visitor more than once.

Start with list_sites to get the site ids.`;

const SITE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Reads the dashboard files in one directory. */
export class SiteFiles {
  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
  }

  async ids() {
    let names;
    try {
      names = await fs.readdir(this.dataDir);
    } catch (error) {
      throw new Error(`Can't read ${this.dataDir}: ${error.code === 'ENOENT' ? 'no such folder' : error.message}. Pass --data-dir, or set METRONA_DATA_DIR, to where the scheduler writes <siteId>.yaml.`);
    }
    return names.filter((n) => n.endsWith('.yaml')).map((n) => n.slice(0, -5)).filter((id) => SITE_ID.test(id)).sort();
  }

  /** One site's file. The id never leaves the data folder: no separators, no leading dot. */
  async load(siteId) {
    if (!SITE_ID.test(siteId) || path.basename(siteId) !== siteId) throw new Error(`Not a site id: ${siteId}`);
    let text;
    try {
      text = await fs.readFile(path.join(this.dataDir, `${siteId}.yaml`), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`No site "${siteId}". These exist: ${(await this.ids()).join(', ') || 'none yet'}`);
      throw error;
    }
    return yaml.load(text) || {};
  }
}

export function summarize(siteId, data) {
  const m = data.metadata || {};
  const s = data.summary || {};
  return {
    siteId: m.site_id || siteId,
    name: m.site_name || m.domain || siteId,
    domain: m.domain || null,
    pageviews: s.total_pageviews || 0,
    visitors: s.unique_visitors || 0,
    period: m.period || null,
    updated: m.generated_at || null,
  };
}

const json = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const failure = (error) => ({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {Object} [options]
 * @param {string} [options.dataDir] - Where the scheduler writes `<siteId>.yaml`
 * @param {string} [options.version] - Reported to clients
 * @returns {McpServer}
 */
export function createServer({ dataDir = DEFAULT_DATA_DIR, version = '1.0.0' } = {}) {
  const files = new SiteFiles(dataDir);
  const server = new McpServer({ name: 'metrona', version }, { instructions: INSTRUCTIONS });
  const tool = (name, config, handler) =>
    server.registerTool(name, { ...config, annotations: readOnly }, async (args) => {
      try {
        return json(await handler(args));
      } catch (error) {
        return failure(error);
      }
    });
  const siteId = z.string().describe('Site id from list_sites, e.g. "example-com"');

  tool('list_sites', {
    title: 'Sites',
    description: 'Every site Metrona counts: id, domain, pageviews and visitors over the logged period, and when the numbers were last updated.',
  }, async () => {
    const ids = await files.ids();
    return Promise.all(ids.map(async (id) => summarize(id, await files.load(id))));
  });

  tool('get_top', {
    title: 'Top pages or referrers',
    description: "A site's most viewed pages, or the domains that sent it the most visits, over the logged period (see list_sites' period).",
    inputSchema: {
      siteId,
      kind: z.enum(['pages', 'referrers']).describe('"pages" for top pages, "referrers" for referring domains'),
      limit: z.number().int().min(1).max(100).default(10),
    },
  }, async ({ siteId: id, kind, limit }) => {
    const data = await files.load(id);
    const rows = kind === 'pages' ? data.top_pages || [] : (data.referrers && data.referrers.by_domain) || [];
    return { ...summarize(id, data), kind, rows: rows.slice(0, limit) };
  });

  tool('get_daily_trend', {
    title: 'Daily trend',
    description: 'Pageviews and visitors for each UTC day, optionally from and to a date (YYYY-MM-DD, both included). Kept after old logs are rotated away.',
    inputSchema: {
      siteId,
      from: z.string().regex(DATE).optional().describe('First day, YYYY-MM-DD'),
      to: z.string().regex(DATE).optional().describe('Last day, YYYY-MM-DD'),
    },
  }, async ({ siteId: id, from = '0000-00-00', to = '9999-99-99' }) => {
    const data = await files.load(id);
    const days = ((data.time_series && data.time_series.daily) || []).filter((d) => d.date >= from && d.date <= to);
    const pageviews = days.reduce((sum, d) => sum + (d.pageviews || 0), 0);
    return { siteId: id, from: days[0]?.date ?? null, to: days.at(-1)?.date ?? null, days: days.length, pageviews, daily: days };
  });

  return server;
}

/** Serve over stdio until the client goes away. */
export async function serveStdio(options) {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = createServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}
