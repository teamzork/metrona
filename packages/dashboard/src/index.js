/**
 * @fileoverview Main entry point for the dashboard package
 */

const { StaticDashboard } = require('./static-dashboard');
const { ServerDashboard } = require('./server-dashboard');
const { publishSite } = require('./publish');
const { buildView, renderSitePage } = require('./site-view');

module.exports = {
  StaticDashboard,
  ServerDashboard,
  publishSite,
  buildView,
  renderSitePage
};