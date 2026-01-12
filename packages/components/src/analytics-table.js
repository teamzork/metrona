/**
 * @fileoverview AnalyticsTable Web Component
 * Displays analytics data in sortable, paginated tables
 */

const { BaseAnalyticsComponent } = require('./base-component');

/**
 * Analytics Table Component
 * Renders analytics data as sortable tables with pagination
 */
class AnalyticsTable extends BaseAnalyticsComponent {
  constructor() {
    super();
    this.dataType = 'pages'; // 'pages', 'referrers', 'timeSeries'
    this.pageSize = 10;
    this.currentPage = 1;
    this.sortColumn = null;
    this.sortDirection = 'desc';
    this.showPagination = true;
  }

  static get observedAttributes() {
    return [...super.observedAttributes, 'data-type', 'page-size', 'show-pagination'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    
    if (oldValue === newValue) return;

    switch (name) {
      case 'data-type':
        this.dataType = newValue || 'pages';
        this.currentPage = 1;
        this.render();
        break;
      case 'page-size':
        this.pageSize = parseInt(newValue) || 10;
        this.currentPage = 1;
        this.render();
        break;
      case 'show-pagination':
        this.showPagination = newValue !== 'false';
        this.render();
        break;
    }
  }

  /**
   * Validate that data has required structure
   */
  validateData(data) {
    return super.validateData(data) && 
           data.analytics && 
           typeof data.analytics === 'object';
  }

  /**
   * Get table data based on data type
   */
  getTableData(data) {
    const filteredData = this.filterDataByTimeRange(data);
    const analytics = filteredData.analytics;

    if (!analytics) return { rows: [], columns: [] };

    switch (this.dataType) {
      case 'pages':
        return this.getPagesData(analytics);
      case 'referrers':
        return this.getReferrersData(analytics);
      case 'timeSeries':
        return this.getTimeSeriesData(analytics);
      default:
        return { rows: [], columns: [] };
    }
  }

  /**
   * Get pages table data
   */
  getPagesData(analytics) {
    const columns = [
      { key: 'path', label: 'Page', sortable: true },
      { key: 'views', label: 'Views', sortable: true, numeric: true },
      { key: 'percentage', label: '%', sortable: true, numeric: true }
    ];

    if (!analytics.topPages || !Array.isArray(analytics.topPages)) {
      return { rows: [], columns };
    }

    const totalViews = analytics.topPages.reduce((sum, page) => sum + (page.views || 0), 0);

    const rows = analytics.topPages.map(page => ({
      path: page.path || '/',
      views: page.views || 0,
      percentage: totalViews > 0 ? ((page.views || 0) / totalViews * 100).toFixed(1) : '0.0'
    }));

    return { rows, columns };
  }

  /**
   * Get referrers table data
   */
  getReferrersData(analytics) {
    const columns = [
      { key: 'domain', label: 'Referrer', sortable: true },
      { key: 'visits', label: 'Visits', sortable: true, numeric: true },
      { key: 'percentage', label: '%', sortable: true, numeric: true }
    ];

    if (!analytics.topReferrers || !Array.isArray(analytics.topReferrers)) {
      return { rows: [], columns };
    }

    const totalVisits = analytics.topReferrers.reduce((sum, ref) => sum + (ref.visits || 0), 0);

    const rows = analytics.topReferrers.map(referrer => ({
      domain: referrer.domain || 'Direct',
      visits: referrer.visits || 0,
      percentage: totalVisits > 0 ? ((referrer.visits || 0) / totalVisits * 100).toFixed(1) : '0.0'
    }));

    return { rows, columns };
  }

  /**
   * Get time series table data
   */
  getTimeSeriesData(analytics) {
    const columns = [
      { key: 'date', label: 'Date', sortable: true },
      { key: 'pageviews', label: 'Pageviews', sortable: true, numeric: true },
      { key: 'uniqueVisitors', label: 'Visitors', sortable: true, numeric: true }
    ];

    if (!analytics.timeSeries || !Array.isArray(analytics.timeSeries)) {
      return { rows: [], columns };
    }

    const rows = analytics.timeSeries.map(entry => ({
      date: this.formatDate(new Date(entry.date)),
      pageviews: entry.pageviews || 0,
      uniqueVisitors: entry.uniqueVisitors || 0
    }));

    return { rows, columns };
  }

  /**
   * Format date for display
   */
  formatDate(date) {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  /**
   * Sort table data
   */
  sortData(rows, column, direction) {
    return [...rows].sort((a, b) => {
      let aVal = a[column];
      let bVal = b[column];

      // Handle numeric columns
      if (typeof aVal === 'string' && !isNaN(parseFloat(aVal))) {
        aVal = parseFloat(aVal);
        bVal = parseFloat(bVal);
      }

      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  /**
   * Paginate data
   */
  paginateData(rows) {
    if (!this.showPagination) return rows;

    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    return rows.slice(startIndex, endIndex);
  }

  /**
   * Handle sort click
   */
  handleSort(column) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'desc';
    }
    this.render();
  }

  /**
   * Handle pagination
   */
  handlePageChange(page) {
    this.currentPage = page;
    this.render();
  }

  /**
   * Format numbers for display
   */
  formatNumber(num) {
    if (typeof num === 'string') return num;
    return num.toLocaleString();
  }

  /**
   * Get component-specific styles
   */
  getComponentStyles() {
    return `
      .table-container {
        width: 100%;
        overflow-x: auto;
      }

      .table-title {
        font-size: 1rem;
        font-weight: 600;
        color: var(--analytics-text-color, #333);
        margin-bottom: 16px;
      }

      .analytics-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }

      .analytics-table th,
      .analytics-table td {
        padding: 12px 8px;
        text-align: left;
        border-bottom: 1px solid var(--analytics-border-color, #e0e0e0);
      }

      .analytics-table th {
        background: var(--analytics-border-color, #f5f5f5);
        font-weight: 600;
        color: var(--analytics-text-color, #333);
        position: sticky;
        top: 0;
        z-index: 1;
      }

      .analytics-table th.sortable {
        cursor: pointer;
        user-select: none;
        position: relative;
      }

      .analytics-table th.sortable:hover {
        background: var(--analytics-accent-color, #007bff);
        color: white;
      }

      .analytics-table th.sorted::after {
        content: '';
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        width: 0;
        height: 0;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
      }

      .analytics-table th.sorted.asc::after {
        border-bottom: 6px solid currentColor;
      }

      .analytics-table th.sorted.desc::after {
        border-top: 6px solid currentColor;
      }

      .analytics-table td.numeric {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .analytics-table tbody tr:hover {
        background: var(--analytics-border-color, #f9f9f9);
      }

      .pagination {
        display: flex;
        justify-content: center;
        align-items: center;
        margin-top: 16px;
        gap: 8px;
      }

      .pagination-button {
        padding: 6px 12px;
        border: 1px solid var(--analytics-border-color, #e0e0e0);
        background: var(--analytics-bg-color, #fff);
        color: var(--analytics-text-color, #333);
        cursor: pointer;
        border-radius: 4px;
        font-size: 0.875rem;
      }

      .pagination-button:hover:not(:disabled) {
        background: var(--analytics-accent-color, #007bff);
        color: white;
      }

      .pagination-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .pagination-button.active {
        background: var(--analytics-accent-color, #007bff);
        color: white;
      }

      .pagination-info {
        font-size: 0.75rem;
        color: var(--analytics-text-color, #666);
        margin: 0 16px;
      }

      .no-data {
        text-align: center;
        padding: 32px;
        color: var(--analytics-text-color, #666);
        font-style: italic;
      }

      @media (max-width: 768px) {
        .analytics-table th,
        .analytics-table td {
          padding: 8px 4px;
          font-size: 0.75rem;
        }

        .table-title {
          font-size: 0.875rem;
          margin-bottom: 12px;
        }

        .pagination {
          flex-wrap: wrap;
          gap: 4px;
        }

        .pagination-button {
          padding: 4px 8px;
          font-size: 0.75rem;
        }
      }
    `;
  }

  /**
   * Get table title based on data type
   */
  getTableTitle() {
    const titles = {
      pages: 'Top Pages',
      referrers: 'Top Referrers',
      timeSeries: 'Analytics Over Time'
    };
    return titles[this.dataType] || 'Analytics Data';
  }

  /**
   * Render pagination controls
   */
  renderPagination(totalRows) {
    if (!this.showPagination || totalRows <= this.pageSize) return '';

    const totalPages = Math.ceil(totalRows / this.pageSize);
    const startItem = (this.currentPage - 1) * this.pageSize + 1;
    const endItem = Math.min(this.currentPage * this.pageSize, totalRows);

    let pagination = `
      <div class="pagination">
        <button 
          class="pagination-button" 
          ${this.currentPage === 1 ? 'disabled' : ''}
          onclick="this.getRootNode().host.handlePageChange(${this.currentPage - 1})"
        >Previous</button>
    `;

    // Show page numbers (with ellipsis for large ranges)
    const maxVisiblePages = 5;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage < maxVisiblePages - 1) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pagination += `
        <button 
          class="pagination-button ${i === this.currentPage ? 'active' : ''}"
          onclick="this.getRootNode().host.handlePageChange(${i})"
        >${i}</button>
      `;
    }

    pagination += `
        <button 
          class="pagination-button"
          ${this.currentPage === totalPages ? 'disabled' : ''}
          onclick="this.getRootNode().host.handlePageChange(${this.currentPage + 1})"
        >Next</button>
        <div class="pagination-info">
          ${startItem}-${endItem} of ${totalRows}
        </div>
      </div>
    `;

    return pagination;
  }

  /**
   * Render the table
   */
  renderContent() {
    const { rows, columns } = this.getTableData(this.data);

    if (rows.length === 0) {
      this.shadowRoot.innerHTML = `
        <style>
          ${this.getBaseStyles()}
          ${this.getComponentStyles()}
        </style>
        <div>
          <div class="table-title">${this.getTableTitle()}</div>
          <div class="no-data">No data available for the selected time range</div>
        </div>
      `;
      return;
    }

    // Sort data if needed
    let sortedRows = rows;
    if (this.sortColumn) {
      sortedRows = this.sortData(rows, this.sortColumn, this.sortDirection);
    }

    // Paginate data
    const paginatedRows = this.paginateData(sortedRows);

    // Generate table headers
    const headers = columns.map(col => `
      <th 
        class="${col.sortable ? 'sortable' : ''} ${this.sortColumn === col.key ? `sorted ${this.sortDirection}` : ''}"
        ${col.sortable ? `onclick="this.getRootNode().host.handleSort('${col.key}')"` : ''}
      >
        ${col.label}
      </th>
    `).join('');

    // Generate table rows
    const tableRows = paginatedRows.map(row => `
      <tr>
        ${columns.map(col => `
          <td class="${col.numeric ? 'numeric' : ''}">
            ${col.numeric ? this.formatNumber(row[col.key]) : row[col.key]}
          </td>
        `).join('')}
      </tr>
    `).join('');

    const pagination = this.renderPagination(sortedRows.length);

    this.shadowRoot.innerHTML = `
      <style>
        ${this.getBaseStyles()}
        ${this.getComponentStyles()}
      </style>
      <div>
        <div class="table-title">${this.getTableTitle()}</div>
        <div class="table-container">
          <table class="analytics-table">
            <thead>
              <tr>${headers}</tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
        ${pagination}
      </div>
    `;
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('analytics-table')) {
  customElements.define('analytics-table', AnalyticsTable);
}

module.exports = { AnalyticsTable };