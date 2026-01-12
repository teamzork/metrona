/**
 * @fileoverview AnalyticsSummary Web Component
 * Displays key analytics metrics in summary cards
 */

const { BaseAnalyticsComponent } = require('./base-component');

/**
 * Analytics Summary Component
 * Displays key metrics like pageviews, unique visitors, top pages, etc.
 */
class AnalyticsSummary extends BaseAnalyticsComponent {
  constructor() {
    super();
    this.showCards = ['pageviews', 'visitors', 'topPage', 'topReferrer'];
  }

  static get observedAttributes() {
    return [...super.observedAttributes, 'show-cards'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    
    if (name === 'show-cards' && oldValue !== newValue) {
      this.showCards = newValue ? newValue.split(',').map(s => s.trim()) : this.showCards;
      this.render();
    }
  }

  /**
   * Validate that data has required analytics structure
   */
  validateData(data) {
    return super.validateData(data) && 
           data.analytics && 
           typeof data.analytics === 'object';
  }

  /**
   * Calculate summary statistics from analytics data
   */
  calculateSummaryStats(data) {
    const filteredData = this.filterDataByTimeRange(data);
    const analytics = filteredData.analytics;

    if (!analytics) {
      return {
        pageviews: 0,
        visitors: 0,
        topPage: null,
        topReferrer: null,
        avgPageviews: 0,
        bounceRate: 0
      };
    }

    // Calculate total pageviews from time series
    let totalPageviews = 0;
    let totalVisitors = 0;
    
    if (analytics.timeSeries && Array.isArray(analytics.timeSeries)) {
      analytics.timeSeries.forEach(entry => {
        totalPageviews += entry.pageviews || 0;
        totalVisitors += entry.uniqueVisitors || 0;
      });
    }

    // Get top page
    let topPage = null;
    if (analytics.topPages && analytics.topPages.length > 0) {
      topPage = {
        path: analytics.topPages[0].path,
        views: analytics.topPages[0].views
      };
    }

    // Get top referrer
    let topReferrer = null;
    if (analytics.topReferrers && analytics.topReferrers.length > 0) {
      topReferrer = {
        domain: analytics.topReferrers[0].domain,
        visits: analytics.topReferrers[0].visits
      };
    }

    // Calculate averages
    const daysInRange = this.getDaysInTimeRange();
    const avgPageviews = daysInRange > 0 ? Math.round(totalPageviews / daysInRange) : 0;

    return {
      pageviews: totalPageviews,
      visitors: totalVisitors,
      topPage,
      topReferrer,
      avgPageviews,
      bounceRate: analytics.bounceRate || 0
    };
  }

  /**
   * Get number of days in current time range
   */
  getDaysInTimeRange() {
    switch (this.timeRange) {
      case '1d': return 1;
      case '7d': return 7;
      case '30d': return 30;
      case '1y': return 365;
      default: return 30; // Default for 'all'
    }
  }

  /**
   * Format numbers for display
   */
  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  /**
   * Get component-specific styles
   */
  getComponentStyles() {
    return `
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        margin: 0;
      }

      .summary-card {
        background: var(--analytics-bg-color, #fff);
        border: 1px solid var(--analytics-border-color, #e0e0e0);
        border-radius: 8px;
        padding: 16px;
        text-align: center;
        transition: box-shadow 0.2s ease;
      }

      .summary-card:hover {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .card-value {
        font-size: 2rem;
        font-weight: bold;
        color: var(--analytics-accent-color, #007bff);
        margin: 8px 0;
        line-height: 1;
      }

      .card-label {
        font-size: 0.875rem;
        color: var(--analytics-text-color, #666);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0;
      }

      .card-subtitle {
        font-size: 0.75rem;
        color: var(--analytics-text-color, #999);
        margin: 4px 0 0 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .time-range-indicator {
        font-size: 0.75rem;
        color: var(--analytics-text-color, #666);
        text-align: center;
        margin-bottom: 16px;
        padding: 4px 8px;
        background: var(--analytics-border-color, #f5f5f5);
        border-radius: 4px;
        display: inline-block;
      }

      @media (max-width: 768px) {
        .summary-grid {
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 12px;
        }

        .summary-card {
          padding: 12px;
        }

        .card-value {
          font-size: 1.5rem;
        }
      }

      @media (max-width: 480px) {
        .summary-grid {
          grid-template-columns: 1fr 1fr;
        }
      }
    `;
  }

  /**
   * Render the summary cards
   */
  renderContent() {
    const stats = this.calculateSummaryStats(this.data);
    const timeRangeLabel = this.getTimeRangeLabel();

    const cards = [];

    if (this.showCards.includes('pageviews')) {
      cards.push(`
        <div class="summary-card">
          <div class="card-label">Pageviews</div>
          <div class="card-value">${this.formatNumber(stats.pageviews)}</div>
          <div class="card-subtitle">Avg: ${this.formatNumber(stats.avgPageviews)}/day</div>
        </div>
      `);
    }

    if (this.showCards.includes('visitors')) {
      cards.push(`
        <div class="summary-card">
          <div class="card-label">Unique Visitors</div>
          <div class="card-value">${this.formatNumber(stats.visitors)}</div>
        </div>
      `);
    }

    if (this.showCards.includes('topPage') && stats.topPage) {
      cards.push(`
        <div class="summary-card">
          <div class="card-label">Top Page</div>
          <div class="card-value">${this.formatNumber(stats.topPage.views)}</div>
          <div class="card-subtitle" title="${stats.topPage.path}">${stats.topPage.path}</div>
        </div>
      `);
    }

    if (this.showCards.includes('topReferrer') && stats.topReferrer) {
      cards.push(`
        <div class="summary-card">
          <div class="card-label">Top Referrer</div>
          <div class="card-value">${this.formatNumber(stats.topReferrer.visits)}</div>
          <div class="card-subtitle" title="${stats.topReferrer.domain}">${stats.topReferrer.domain}</div>
        </div>
      `);
    }

    if (this.showCards.includes('bounceRate') && stats.bounceRate > 0) {
      cards.push(`
        <div class="summary-card">
          <div class="card-label">Bounce Rate</div>
          <div class="card-value">${Math.round(stats.bounceRate)}%</div>
        </div>
      `);
    }

    this.shadowRoot.innerHTML = `
      <style>
        ${this.getBaseStyles()}
        ${this.getComponentStyles()}
      </style>
      <div>
        ${timeRangeLabel ? `<div class="time-range-indicator">${timeRangeLabel}</div>` : ''}
        <div class="summary-grid">
          ${cards.join('')}
        </div>
      </div>
    `;
  }

  /**
   * Get human-readable time range label
   */
  getTimeRangeLabel() {
    const labels = {
      '1d': 'Last 24 hours',
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      '1y': 'Last year',
      'all': 'All time'
    };
    return labels[this.timeRange] || '';
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('analytics-summary')) {
  customElements.define('analytics-summary', AnalyticsSummary);
}

module.exports = { AnalyticsSummary };