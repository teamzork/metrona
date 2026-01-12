/**
 * @fileoverview Main entry point for the dashboard package
 */

const { StaticDashboard } = require('./static-dashboard');
const { ServerDashboard } = require('./server-dashboard');

module.exports = {
  StaticDashboard,
  ServerDashboard
};