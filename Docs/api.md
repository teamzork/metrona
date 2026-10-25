# API Reference

This document describes the APIs and interfaces provided by the Metrona Analytics System.

## Dashboard API

When running in server mode, the dashboard provides REST endpoints for data access.

### Authentication

All API endpoints require authentication via session cookies or HTTP Basic Auth.

```bash
# Login to get session cookie
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your-password"}'
```

### Endpoints

#### GET /api/sites

List all configured sites.

**Response:**
```json
{
  "sites": [
    {
      "domain": "example.com",
      "enabled": true,
      "lastProcessed": "2026-01-04T12:00:00Z"
    }
  ]
}
```

#### GET /api/data/:domain

Get analytics data for a specific site.

**Parameters:**
- `domain` - Site domain name
- `range` - Time range (1d, 7d, 30d, 1y, all) [optional]

**Response:**
```json
{
  "generatedAt": "2026-01-04T12:00:00Z",
  "site": "example.com",
  "summary": {
    "totalPageviews": 15420,
    "uniqueVisitors": 3201,
    "topPage": "/blog/post-123",
    "topReferrer": "google.com"
  },
  "timeframes": { ... },
  "topPages": [ ... ],
  "topReferrers": [ ... ]
}
```

#### GET /api/export/:domain

Export analytics data as CSV.

**Parameters:**
- `domain` - Site domain name
- `type` - Export type (summary, pages, referrers, timeseries)
- `range` - Time range [optional]

**Response:** CSV file download

## Component API

Web Components provide a declarative API for embedding analytics.

### Analytics Summary

Display key metrics in summary cards.

```html
<analytics-summary 
  data-url="/analytics/data.yaml"
  time-range="7d">
</analytics-summary>
```

**Attributes:**
- `data-url` - URL to YAML data file
- `time-range` - Time period to display (1d, 7d, 30d, 1y, all)

### Analytics Chart

Render time-series charts.

```html
<analytics-chart 
  type="line" 
  metric="pageviews" 
  range="30d"
  data-url="/analytics/data.yaml">
</analytics-chart>
```

**Attributes:**
- `type` - Chart type (line, bar)
- `metric` - Metric to display (pageviews, visitors)
- `range` - Time range
- `data-url` - URL to YAML data file

### Analytics Table

Display rankings in table format.

```html
<analytics-table 
  metric="top-pages" 
  limit="10"
  data-url="/analytics/data.yaml">
</analytics-table>
```

**Attributes:**
- `metric` - Data to display (top-pages, top-referrers)
- `limit` - Number of items to show
- `data-url` - URL to YAML data file

## CLI API

Command-line interface for system management.

### Setup

Interactive setup wizard.

```bash
metrona setup [options]
```

**Options:**
- `--config <path>` - Configuration file path
- `--data-path <path>` - Data storage path
- `--port <number>` - Dashboard port
- `--automated` - Skip interactive prompts

### Site Management

Add a new site to monitoring.

```bash
metrona add-site <domain> [options]
```

**Options:**
- `--log-path <path>` - nginx log file path
- `--frequency <freq>` - Processing frequency
- `--nginx-config <path>` - nginx configuration file

Remove a site from monitoring.

```bash
metrona remove-site <domain>
```

### Status

Show system status and health.

```bash
metrona status [options]
```

**Options:**
- `--verbose` - Show detailed information
- `--json` - Output in JSON format

## Parser API

Programmatic interface for log processing.

### NginxLogParser

```javascript
const { NginxLogParser } = require('@metrona/parser');

const parser = new NginxLogParser('/var/log/nginx/access.log');
const analytics = await parser.generateAnalytics();
```

### AnalyticsCalculator

```javascript
const { AnalyticsCalculator } = require('@metrona/parser');

const calculator = new AnalyticsCalculator();
const uniqueVisitors = calculator.calculateUniqueVisitors(logEntries);
const rankings = calculator.rankContent(logEntries, 'pageviews');
```

## Configuration API

YAML configuration structure and validation.

### Site Configuration

```yaml
sites:
  - domain: example.com
    nginx_config: /etc/nginx/sites-available/example.com
    log_path: /var/log/nginx/example.com-analytics.log
    frequency: daily
    enabled: true
    exclusions:
      - /admin/*
      - "*.css"
      - "*.js"
```

### Dashboard Configuration

```yaml
dashboard:
  enabled: true
  port: 3001
  password_hash: $2b$12$...
  rate_limit: 10
```

### Storage Configuration

```yaml
storage:
  data_path: /var/analytics/data
  backup_enabled: true
  retention_days: 365
```

## Error Handling

All APIs use consistent error response format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": { ... }
  }
}
```

Common error codes:
- `CONFIG_INVALID` - Configuration validation failed
- `FILE_NOT_FOUND` - Required file not found
- `AUTH_FAILED` - Authentication failed
- `RATE_LIMIT_EXCEEDED` - Too many requests