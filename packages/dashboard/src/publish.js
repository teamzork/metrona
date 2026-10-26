/**
 * @fileoverview Static pages: one site's page written as plain files, for the web server that
 * already runs the site to serve at, say, example.com/stats/ behind a password. No Metrona
 * process is involved in serving it; the scheduler rewrites the files after every run.
 *
 *   <dir>/<siteId>/index.html
 *   <dir>/<siteId>/assets/site.css, site.js
 */

const fs = require('fs').promises;
const path = require('path');
const { buildView, renderSitePage } = require('./site-view');

const ASSETS = ['site.css', 'site.js'];
const PUBLIC = path.join(__dirname, '../public');
const SITE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Write a file so that a reader sees the old one or the new one, never half of one. */
async function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, { mode: 0o644 });
  await fs.rename(tmp, file);
}

/**
 * @param {Object} params
 * @param {Object} params.data - The site's dashboard file (`<siteId>.yaml`, parsed)
 * @param {Object} params.site - { siteId, name, domain }
 * @param {string} params.dir - The publish folder; the site's page goes in <dir>/<siteId>/
 * @param {number} [params.now]
 * @returns {Promise<string>} The page's path
 */
async function publishSite({ data, site, dir, now = Date.now() }) {
  if (!site || !SITE_ID.test(site.siteId || '')) throw new Error(`Not a site id: ${site && site.siteId}`);
  const root = path.join(dir, site.siteId);
  await fs.mkdir(path.join(root, 'assets'), { recursive: true, mode: 0o755 });
  for (const name of ASSETS) {
    await writeAtomic(path.join(root, 'assets', name), await fs.readFile(path.join(PUBLIC, name)));
  }
  const html = renderSitePage(buildView(data, site, { now }), { assetBase: 'assets', now });
  const page = path.join(root, 'index.html');
  await writeAtomic(page, html);
  return page;
}

module.exports = { publishSite };
