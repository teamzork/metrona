/**
 * @fileoverview Base Web Component class for analytics components
 * Provides common functionality for data loading, lazy loading, and theming
 */

const yaml = require('js-yaml');

/**
 * Base class for all analytics Web Components
 * Provides data loading, lazy loading, and theming capabilities
 */
class BaseAnalyticsComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = null;
    this.loading = false;
    this.error = null;
    this.intersectionObserver = null;
    this.dataUrl = null;
    this.timeRange = 'all';
  }

  /**
   * Attributes to observe for changes
   */
  static get observedAttributes() {
    return ['data-url', 'time-range', 'theme'];
  }

  /**
   * Called when component is added to DOM
   */
  async connectedCallback() {
    this.setupIntersectionObserver();
    this.setupInitialAttributes();
    this.render();
  }

  /**
   * Called when component is removed from DOM
   */
  disconnectedCallback() {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
  }

  /**
   * Called when observed attributes change
   */
  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case 'data-url':
        this.dataUrl = newValue;
        if (this.isVisible()) {
          this.loadData();
        }
        break;
      case 'time-range':
        this.timeRange = newValue || 'all';
        this.render();
        break;
      case 'theme':
        this.updateTheme(newValue);
        break;
    }
  }

  /**
   * Set up intersection observer for lazy loading
   */
  setupIntersectionObserver() {
    if ('IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !this.data && !this.loading) {
              this.loadData();
            }
          });
        },
        { threshold: 0.1 }
      );
      this.intersectionObserver.observe(this);
    } else {
      // Fallback for browsers without IntersectionObserver
      this.loadData();
    }
  }

  /**
   * Initialize attributes from HTML
   */
  setupInitialAttributes() {
    this.dataUrl = this.getAttribute('data-url');
    this.timeRange = this.getAttribute('time-range') || 'all';
    
    if (this.getAttribute('theme')) {
      this.updateTheme(this.getAttribute('theme'));
    }
  }

  /**
   * Check if component is visible (for fallback when IntersectionObserver not available)
   */
  isVisible() {
    const rect = this.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  }

  /**
   * Load analytics data from configured URL
   */
  async loadData() {
    if (!this.dataUrl || this.loading) return;

    this.loading = true;
    this.error = null;
    this.render(); // Show loading state

    try {
      const response = await fetch(this.dataUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const yamlText = await response.text();
      const data = yaml.load(yamlText);

      if (!this.validateData(data)) {
        throw new Error('Invalid data format received');
      }

      this.data = data;
      this.emitDataLoadedEvent();
    } catch (error) {
      this.error = error.message;
      console.error(`Failed to load analytics data from ${this.dataUrl}:`, error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Validate loaded data structure
   * Override in subclasses for specific validation
   */
  validateData(data) {
    return data && typeof data === 'object';
  }

  /**
   * Emit custom event when data is loaded
   */
  emitDataLoadedEvent() {
    const event = new CustomEvent('analytics-data-loaded', {
      detail: {
        component: this.tagName.toLowerCase(),
        data: this.data,
        timestamp: new Date().toISOString()
      },
      bubbles: true
    });
    this.dispatchEvent(event);
  }

  /**
   * Update component theme using CSS custom properties
   */
  updateTheme(theme) {
    if (!theme) return;

    // Apply theme as CSS class and custom properties
    this.className = `analytics-component theme-${theme}`;
    
    // Set CSS custom properties for theming
    const themeProperties = this.getThemeProperties(theme);
    Object.entries(themeProperties).forEach(([property, value]) => {
      this.style.setProperty(property, value);
    });
  }

  /**
   * Get theme properties for a given theme name
   * Override in subclasses for custom themes
   */
  getThemeProperties(theme) {
    const themes = {
      light: {
        '--analytics-bg-color': '#ffffff',
        '--analytics-text-color': '#333333',
        '--analytics-border-color': '#e0e0e0',
        '--analytics-accent-color': '#007bff',
        '--analytics-success-color': '#28a745',
        '--analytics-warning-color': '#ffc107',
        '--analytics-error-color': '#dc3545'
      },
      dark: {
        '--analytics-bg-color': '#1a1a1a',
        '--analytics-text-color': '#ffffff',
        '--analytics-border-color': '#404040',
        '--analytics-accent-color': '#4dabf7',
        '--analytics-success-color': '#51cf66',
        '--analytics-warning-color': '#ffd43b',
        '--analytics-error-color': '#ff6b6b'
      },
      minimal: {
        '--analytics-bg-color': 'transparent',
        '--analytics-text-color': 'inherit',
        '--analytics-border-color': '#cccccc',
        '--analytics-accent-color': '#666666',
        '--analytics-success-color': '#666666',
        '--analytics-warning-color': '#666666',
        '--analytics-error-color': '#666666'
      }
    };

    return themes[theme] || themes.light;
  }

  /**
   * Filter data by time range
   */
  filterDataByTimeRange(data, timeRange = this.timeRange) {
    if (!data || !data.analytics || timeRange === 'all') {
      return data;
    }

    const now = new Date();
    let cutoffDate;

    switch (timeRange) {
      case '1d':
        cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        cutoffDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        return data;
    }

    // Filter time-series data
    const filteredData = { ...data };
    if (filteredData.analytics && filteredData.analytics.timeSeries) {
      filteredData.analytics.timeSeries = filteredData.analytics.timeSeries.filter(
        entry => new Date(entry.date) >= cutoffDate
      );
    }

    return filteredData;
  }

  /**
   * Get base CSS styles for all components
   */
  getBaseStyles() {
    return `
      :host {
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: var(--analytics-text-color, #333);
        background: var(--analytics-bg-color, #fff);
        border: 1px solid var(--analytics-border-color, #e0e0e0);
        border-radius: 4px;
        padding: 16px;
        box-sizing: border-box;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100px;
        color: var(--analytics-accent-color, #007bff);
      }

      .error {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100px;
        color: var(--analytics-error-color, #dc3545);
        text-align: center;
      }

      .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid var(--analytics-border-color, #e0e0e0);
        border-top: 2px solid var(--analytics-accent-color, #007bff);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-right: 8px;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      @media (max-width: 768px) {
        :host {
          padding: 12px;
        }
      }
    `;
  }

  /**
   * Render the component
   * Override in subclasses for specific rendering
   */
  render() {
    if (this.loading) {
      this.shadowRoot.innerHTML = `
        <style>${this.getBaseStyles()}</style>
        <div class="loading">
          <div class="spinner"></div>
          Loading analytics data...
        </div>
      `;
      return;
    }

    if (this.error) {
      this.shadowRoot.innerHTML = `
        <style>${this.getBaseStyles()}</style>
        <div class="error">
          Error loading data: ${this.error}
        </div>
      `;
      return;
    }

    if (!this.data) {
      this.shadowRoot.innerHTML = `
        <style>${this.getBaseStyles()}</style>
        <div class="loading">
          No data available
        </div>
      `;
      return;
    }

    // Subclasses should override this method
    this.renderContent();
  }

  /**
   * Render component content with data
   * Override in subclasses
   */
  renderContent() {
    this.shadowRoot.innerHTML = `
      <style>${this.getBaseStyles()}</style>
      <div>Base component - override renderContent() method</div>
    `;
  }
}

module.exports = { BaseAnalyticsComponent };