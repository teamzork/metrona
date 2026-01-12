/**
 * @fileoverview AnalyticsChart Web Component
 * Displays analytics data as line charts and bar charts
 */

const { BaseAnalyticsComponent } = require('./base-component');

/**
 * Analytics Chart Component
 * Renders time-series data as SVG charts (line or bar charts)
 */
class AnalyticsChart extends BaseAnalyticsComponent {
  constructor() {
    super();
    this.chartType = 'line'; // 'line' or 'bar'
    this.metric = 'pageviews'; // 'pageviews' or 'visitors'
    this.height = 300;
    this.showGrid = true;
    this.showLabels = true;
  }

  static get observedAttributes() {
    return [...super.observedAttributes, 'chart-type', 'metric', 'height', 'show-grid', 'show-labels'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    
    if (oldValue === newValue) return;

    switch (name) {
      case 'chart-type':
        this.chartType = newValue || 'line';
        this.render();
        break;
      case 'metric':
        this.metric = newValue || 'pageviews';
        this.render();
        break;
      case 'height':
        this.height = parseInt(newValue) || 300;
        this.render();
        break;
      case 'show-grid':
        this.showGrid = newValue !== 'false';
        this.render();
        break;
      case 'show-labels':
        this.showLabels = newValue !== 'false';
        this.render();
        break;
    }
  }

  /**
   * Validate that data has time series information
   */
  validateData(data) {
    return super.validateData(data) && 
           data.analytics && 
           data.analytics.timeSeries &&
           Array.isArray(data.analytics.timeSeries);
  }

  /**
   * Prepare chart data from analytics
   */
  prepareChartData(data) {
    const filteredData = this.filterDataByTimeRange(data);
    const timeSeries = filteredData.analytics.timeSeries || [];

    if (timeSeries.length === 0) {
      return { points: [], maxValue: 0, minValue: 0 };
    }

    // Extract values based on selected metric
    const points = timeSeries.map(entry => ({
      date: new Date(entry.date),
      value: entry[this.metric] || 0,
      label: this.formatDate(new Date(entry.date))
    }));

    // Sort by date
    points.sort((a, b) => a.date - b.date);

    const values = points.map(p => p.value);
    const maxValue = Math.max(...values, 1); // Ensure minimum of 1
    const minValue = Math.min(...values, 0);

    return { points, maxValue, minValue };
  }

  /**
   * Format date for display
   */
  formatDate(date) {
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
    if (diffDays < 365) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  }

  /**
   * Generate SVG path for line chart
   */
  generateLinePath(points, width, height, maxValue) {
    if (points.length === 0) return '';

    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const pathPoints = points.map((point, index) => {
      const x = padding + (index / (points.length - 1)) * chartWidth;
      const y = padding + chartHeight - (point.value / maxValue) * chartHeight;
      return `${x},${y}`;
    });

    return `M ${pathPoints.join(' L ')}`;
  }

  /**
   * Generate SVG bars for bar chart
   */
  generateBars(points, width, height, maxValue) {
    if (points.length === 0) return '';

    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const barWidth = chartWidth / points.length * 0.8;
    const barSpacing = chartWidth / points.length * 0.2;

    return points.map((point, index) => {
      const x = padding + index * (chartWidth / points.length) + barSpacing / 2;
      const barHeight = (point.value / maxValue) * chartHeight;
      const y = padding + chartHeight - barHeight;

      return `
        <rect 
          x="${x}" 
          y="${y}" 
          width="${barWidth}" 
          height="${barHeight}"
          fill="var(--analytics-accent-color, #007bff)"
          opacity="0.8"
          rx="2"
        />
      `;
    }).join('');
  }

  /**
   * Generate grid lines
   */
  generateGrid(width, height, maxValue) {
    if (!this.showGrid) return '';

    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const gridLines = 5;

    let grid = '';

    // Horizontal grid lines
    for (let i = 0; i <= gridLines; i++) {
      const y = padding + (i / gridLines) * chartHeight;
      grid += `
        <line 
          x1="${padding}" 
          y1="${y}" 
          x2="${padding + chartWidth}" 
          y2="${y}"
          stroke="var(--analytics-border-color, #e0e0e0)"
          stroke-width="1"
          opacity="0.5"
        />
      `;
    }

    return grid;
  }

  /**
   * Generate axis labels
   */
  generateLabels(points, width, height, maxValue) {
    if (!this.showLabels || points.length === 0) return '';

    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    let labels = '';

    // Y-axis labels (values)
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const value = Math.round((maxValue / gridLines) * (gridLines - i));
      const y = padding + (i / gridLines) * chartHeight;
      
      labels += `
        <text 
          x="${padding - 10}" 
          y="${y + 4}" 
          text-anchor="end"
          font-size="12"
          fill="var(--analytics-text-color, #666)"
        >${this.formatNumber(value)}</text>
      `;
    }

    // X-axis labels (dates) - show only a few to avoid crowding
    const labelCount = Math.min(points.length, 6);
    const labelStep = Math.max(1, Math.floor(points.length / labelCount));
    
    for (let i = 0; i < points.length; i += labelStep) {
      const point = points[i];
      const x = padding + (i / (points.length - 1)) * chartWidth;
      
      labels += `
        <text 
          x="${x}" 
          y="${padding + chartHeight + 20}" 
          text-anchor="middle"
          font-size="12"
          fill="var(--analytics-text-color, #666)"
        >${point.label}</text>
      `;
    }

    return labels;
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
      .chart-container {
        width: 100%;
        overflow-x: auto;
      }

      .chart-title {
        font-size: 1rem;
        font-weight: 600;
        color: var(--analytics-text-color, #333);
        margin-bottom: 16px;
        text-align: center;
      }

      .chart-svg {
        width: 100%;
        height: ${this.height}px;
        background: var(--analytics-bg-color, #fff);
      }

      .chart-line {
        fill: none;
        stroke: var(--analytics-accent-color, #007bff);
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .chart-area {
        fill: var(--analytics-accent-color, #007bff);
        opacity: 0.1;
      }

      .no-data {
        display: flex;
        align-items: center;
        justify-content: center;
        height: ${this.height}px;
        color: var(--analytics-text-color, #666);
        font-style: italic;
      }

      @media (max-width: 768px) {
        .chart-title {
          font-size: 0.875rem;
          margin-bottom: 12px;
        }
      }
    `;
  }

  /**
   * Get chart title based on metric and time range
   */
  getChartTitle() {
    const metricLabels = {
      pageviews: 'Pageviews',
      visitors: 'Unique Visitors'
    };

    const timeRangeLabels = {
      '1d': 'Last 24 hours',
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      '1y': 'Last year',
      'all': 'All time'
    };

    const metricLabel = metricLabels[this.metric] || 'Analytics';
    const timeLabel = timeRangeLabels[this.timeRange] || '';

    return timeLabel ? `${metricLabel} - ${timeLabel}` : metricLabel;
  }

  /**
   * Render the chart
   */
  renderContent() {
    const chartData = this.prepareChartData(this.data);
    
    if (chartData.points.length === 0) {
      this.shadowRoot.innerHTML = `
        <style>
          ${this.getBaseStyles()}
          ${this.getComponentStyles()}
        </style>
        <div>
          <div class="chart-title">${this.getChartTitle()}</div>
          <div class="no-data">No data available for the selected time range</div>
        </div>
      `;
      return;
    }

    const width = 600; // Base width, will be responsive via CSS
    const height = this.height;
    const { points, maxValue } = chartData;

    const grid = this.generateGrid(width, height, maxValue);
    const labels = this.generateLabels(points, width, height, maxValue);

    let chartElements = '';
    if (this.chartType === 'line') {
      const linePath = this.generateLinePath(points, width, height, maxValue);
      chartElements = `
        <path class="chart-line" d="${linePath}" />
      `;
    } else {
      chartElements = this.generateBars(points, width, height, maxValue);
    }

    this.shadowRoot.innerHTML = `
      <style>
        ${this.getBaseStyles()}
        ${this.getComponentStyles()}
      </style>
      <div>
        <div class="chart-title">${this.getChartTitle()}</div>
        <div class="chart-container">
          <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
            ${grid}
            ${chartElements}
            ${labels}
          </svg>
        </div>
      </div>
    `;
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('analytics-chart')) {
  customElements.define('analytics-chart', AnalyticsChart);
}

module.exports = { AnalyticsChart };