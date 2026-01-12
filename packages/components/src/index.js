/**
 * @fileoverview Main entry point for the components package
 * Exports all analytics Web Components for embedding in applications
 */

const { BaseAnalyticsComponent } = require('./base-component');
const { AnalyticsSummary } = require('./analytics-summary');
const { AnalyticsChart } = require('./analytics-chart');
const { AnalyticsTable } = require('./analytics-table');

// Export all components
module.exports = {
  BaseAnalyticsComponent,
  AnalyticsSummary,
  AnalyticsChart,
  AnalyticsTable
};

// Auto-register components when loaded in browser
if (typeof window !== 'undefined') {
  // Components will auto-register themselves when their modules are loaded
  // This ensures they're available as custom elements
}