/**
 * @fileoverview Writes the dashboard's view of a site: `<dataDir>/<siteId>.yaml` in the snake_case
 * schema the dashboard reads (see demo-dashboard-data/), built from the dataset YamlDatasetWriter
 * keeps. The dataset stays the source of truth; this file is regenerated after every run.
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

/**
 * YYYY-MM-DD of a daily bucket. TimeSeriesGrouper buckets by UTC day whatever the site timezone,
 * so the bucket's UTC date is the day it covers.
 */
function isoOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function bucketDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso).slice(0, 10) : date.toISOString().slice(0, 10);
}

/**
 * @param {Object} dataset - A dataset as written by YamlDatasetWriter (camelCase)
 * @returns {Object} The same data in the dashboard's schema
 */
function toDashboardSchema(dataset) {
  const meta = dataset.metadata || {};
  const site = meta.site || {};
  const summary = dataset.summary || {};
  const pages = (dataset.topContent && dataset.topContent.pages) || [];
  const domains = (dataset.referrers && dataset.referrers.domains) || [];
  const series = dataset.timeSeries || {};

  const topPages = pages.map((p) => ({
    path: p.path,
    pageviews: p.pageviews || 0,
    unique_visitors: p.uniqueVisitors || 0,
    percentage: p.percentage || 0,
  }));

  const out = {
    metadata: {
      site_id: site.id,
      site_name: site.name,
      domain: site.domain,
      generated_at: meta.lastUpdated || meta.generatedAt || new Date().toISOString(),
      period: { start: isoOrNull(summary.dataRange?.start), end: isoOrNull(summary.dataRange?.end) },
    },
    summary: {
      total_pageviews: summary.totalPageviews || 0,
      unique_visitors: summary.uniqueVisitors || 0,
      top_pages: topPages.slice(0, 3).map(({ path: p, pageviews }) => ({ path: p, pageviews })),
      direct_traffic: summary.directTraffic || 0,
      referral_traffic: summary.referralTraffic || 0,
    },
    top_pages: topPages,
    referrers: {
      by_domain: domains.map((d) => ({
        domain: d.domain,
        visits: d.totalReferrals || 0,
        unique_visitors: d.uniqueVisitors || 0,
        percentage: d.percentage || 0,
      })),
    },
    time_series: {
      daily: (series.daily?.buckets || []).map((b) => ({ date: bucketDate(b.timestamp), pageviews: b.pageviews || 0, unique_visitors: b.uniqueVisitors || 0 })),
    },
  };
  if (series.hourly?.buckets?.length) {
    out.time_series.hourly = series.hourly.buckets.map((b) => ({ date: b.timestamp, pageviews: b.pageviews || 0, unique_visitors: b.uniqueVisitors || 0 }));
  }
  return out;
}

/**
 * Writes `<dataDir>/<siteId>.yaml` atomically (temp file + rename), so the dashboard never reads
 * a half-written file.
 * @returns {Promise<string>} The path written
 */
async function writeDashboardFile(dataset, dataDir, siteId) {
  await fs.mkdir(dataDir, { recursive: true });
  const target = path.join(dataDir, `${siteId}.yaml`);
  const tmp = `${target}.tmp-${process.pid}`;
  await fs.writeFile(tmp, yaml.dump(toDashboardSchema(dataset), { indent: 2, lineWidth: 120, noRefs: true }), 'utf8');
  await fs.rename(tmp, target);
  return target;
}

module.exports = { toDashboardSchema, writeDashboardFile };
