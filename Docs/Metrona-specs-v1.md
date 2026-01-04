# Metrona Analytics System - Technical Specification

## Project Overview
A self-hosted, log-based web analytics system for multiple websites. Parses nginx access logs, generates static YAML datasets, and provides both a central dashboard and embeddable components for individual projects.

## Core Principles
- Privacy-focused: no third-party tracking
- Lightweight: log parsing + static data generation
- Modular: separate concerns (parser, scheduler, dashboard, components)
- Server-agnostic: works with nginx (Caddy support planned)
- Framework-agnostic: components work in Next.js, Astro, Express, vanilla HTML

## System Architecture

### Monorepo Structure
```
metrona-analytics-system/
├── package.json (workspace root)
├── packages/
│   ├── cli/                    # Setup wizard + management CLI
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── setup.js    # Interactive setup wizard
│   │   │   │   ├── add-site.js # Add new site to config
│   │   │   │   ├── remove-site.js
│   │   │   │   └── status.js   # Show system status
│   │   │   ├── utils/
│   │   │   │   ├── nginx.js    # nginx config manipulation
│   │   │   │   ├── systemd.js  # systemd service file generation
│   │   │   │   └── prompts.js  # Interactive prompts
│   │   │   └── index.js
│   │   └── package.json
│   │
│   ├── parser/                 # Log parser (core logic)
│   │   ├── src/
│   │   │   ├── parsers/
│   │   │   │   ├── nginx.js    # nginx log format parser
│   │   │   │   └── base.js     # Abstract parser interface
│   │   │   ├── analyzers/
│   │   │   │   ├── pageviews.js
│   │   │   │   ├── referrers.js
│   │   │   │   ├── paths.js
│   │   │   │   └── aggregate.js
│   │   │   ├── output/
│   │   │   │   └── yaml-writer.js
│   │   │   └── index.js
│   │   └── package.json
│   │
│   ├── scheduler/              # Cron daemon
│   │   ├── src/
│   │   │   ├── daemon.js       # Main scheduler loop
│   │   │   ├── job-runner.js   # Executes parser jobs
│   │   │   └── config-watcher.js # Hot-reload config changes
│   │   └── package.json
│   │
│   ├── dashboard/              # Central monitoring dashboard
│   │   ├── public/
│   │   │   ├── index.html      # Main dashboard page
│   │   │   ├── auth.html       # Login page
│   │   │   ├── css/
│   │   │   │   └── styles.css  # Minimal, clean styling
│   │   │   └── js/
│   │   │       ├── app.js      # Dashboard logic
│   │   │       ├── auth.js     # Basic password auth
│   │   │       └── charts.js   # Chart rendering (use same as components)
│   │   ├── server/
│   │   │   └── index.js        # Optional Express server (for auth)
│   │   └── package.json
│   │
│   ├── components/             # Embeddable analytics components
│   │   ├── src/
│   │   │   ├── core/
│   │   │   │   ├── data-loader.js  # Fetch YAML data
│   │   │   │   ├── date-range.js   # Date range selector
│   │   │   │   └── formatter.js    # Number/date formatting
│   │   │   ├── charts/
│   │   │   │   ├── line-chart.js   # Pageviews over time
│   │   │   │   ├── bar-chart.js    # Top pages
│   │   │   │   ├── table.js        # Data tables
│   │   │   │   └── stat-card.js    # Summary cards
│   │   │   └── index.js
│   │   └── package.json
│   │
│   └── shared/                 # Shared types and utilities
│       ├── src/
│       │   ├── types.js        # Data structure definitions
│       │   └── constants.js
│       └── package.json
│
├── templates/
│   ├── nginx/
│   │   ├── log-format.conf     # Custom log format
│   │   └── site-template.conf  # Per-site log configuration
│   ├── systemd/
│   │   └── analytics-scheduler.service
│   └── config/
│       └── analytics-config.yaml.example
│
└── docs/
    ├── setup.md
    ├── architecture.md
    └── api.md
```

## Data Structures

### Config File (`/etc/analytics/config.yaml`)
```yaml
version: 1
storage:
  data_path: /var/analytics/data
  backup_enabled: true

dashboard:
  enabled: true
  port: 3001
  password_hash: <bcrypt-hash>
  
sites:
  - domain: example.com
    nginx_config: /etc/nginx/sites-available/example.com
    log_path: /var/log/nginx/example.com-analytics.log
    frequency: daily  # daily, hourly, or cron expression
    enabled: true
    
  - domain: blog.example.com
    nginx_config: /etc/nginx/sites-available/blog
    log_path: /var/log/nginx/blog-analytics.log
    frequency: "0 */6 * * *"  # every 6 hours
    enabled: true
```

### Data Output (`/var/analytics/data/{domain}/data.yaml`)
```yaml
generated_at: "2026-01-04T12:00:00Z"
site: example.com

summary:
  total_pageviews: 15420
  unique_visitors: 3201  # Approximate based on IP+UA hash
  top_page: /blog/post-123
  top_referrer: google.com

timeframes:
  day_1:
    start: "2026-01-03T00:00:00Z"
    end: "2026-01-04T00:00:00Z"
    pageviews: 450
    unique_visitors: 120
    hourly:
      - hour: 0
        pageviews: 12
      - hour: 1
        pageviews: 8
      # ... all 24 hours
    
  day_7:
    start: "2025-12-28T00:00:00Z"
    end: "2026-01-04T00:00:00Z"
    pageviews: 3200
    unique_visitors: 890
    daily:
      - date: "2025-12-28"
        pageviews: 420
      - date: "2025-12-29"
        pageviews: 380
      # ... all 7 days
  
  day_30: { ... }
  day_365: { ... }
  all_time: { ... }

top_pages:
  - path: /blog/post-123
    pageviews: 1420
    unique_visitors: 890
  - path: /about
    pageviews: 890
    unique_visitors: 560
  # ... top 20

top_referrers:
  - domain: google.com
    pageviews: 4500
    paths:
      - /search?q=analytics: 2300
      - /search?q=web+logs: 1200
  - domain: direct  # No referrer
    pageviews: 3200
  # ... top 20

sections:  # Optional, based on URL patterns
  - name: blog
    pattern: /blog/*
    pageviews: 8500
  - name: docs
    pattern: /docs/*
    pageviews: 2300
```

## Implementation Details

### 1. CLI Package (`@analytics-system/cli`)

**Dependencies:**
- `commander` - CLI framework
- `inquirer` - Interactive prompts
- `chalk` - Colored output
- `js-yaml` - YAML parsing/writing
- `bcryptjs` - Password hashing

**Key Commands:**
```bash
analytics-system setup          # Interactive setup wizard
analytics-system add-site       # Add new site
analytics-system remove-site    # Remove site
analytics-system status         # Show daemon status, last runs
analytics-system test-parser    # Test log parsing manually
```

**Setup Wizard Flow:**
1. Check dependencies (Node.js, nginx/Caddy)
2. Choose installation mode:
   - Full automated (creates systemd services, modifies nginx)
   - Manual (generates instructions)
3. Configure storage location
4. Set dashboard password
5. Add initial sites (with validation)
6. Generate nginx configs
7. Create systemd service files (optional)
8. Install and start services

**nginx Configuration Logic:**
- Backup existing configs to `/etc/nginx/backups/analytics-backup-{timestamp}/`
- Add custom log format to `/etc/nginx/conf.d/analytics-log-format.conf`
- Inject log directives into each site's server block
- Validate configs with `nginx -t` before applying
- Offer rollback if validation fails

### 2. Parser Package (`@analytics-system/parser`)

**Dependencies:**
- `js-yaml` - YAML generation
- `date-fns` - Date manipulation
- `fast-glob` - Log file discovery

**nginx Log Parsing:**
- Use regex to parse combined log format
- Extract: timestamp, path, referrer, user-agent, status, bytes
- Handle log rotation (detect `.1`, `.gz` files)
- Stream processing for large files (don't load entire log into memory)

**Analytics Calculation:**
1. **Pageviews**: Count all successful requests (status 2xx/3xx)
2. **Unique visitors**: Hash of IP + User-Agent (privacy-preserving approximation)
3. **Paths**: Group by request path
4. **Referrers**: Parse and group by domain (exclude own domain)
5. **Time-series**: Bucket by hour/day/month
6. **Sections**: Match paths against regex patterns from config

**Optimization:**
- Process only new log entries since last run (track position in file)
- Use streaming JSON/YAML writers for large datasets
- Incremental updates: merge with existing data.yaml instead of full recalculation

### 3. Scheduler Package (`@analytics-system/scheduler`)

**Dependencies:**
- `node-cron` - Cron job scheduling
- `chokidar` - File watching (config hot-reload)

**Daemon Behavior:**
1. Read config on startup
2. Schedule jobs for each site based on frequency
3. Run parser when job triggers
4. Log output to `/var/log/analytics-scheduler.log`
5. Watch config file for changes (hot-reload without restart)
6. Graceful shutdown on SIGTERM

**Job Execution:**
```javascript
async function runJob(site) {
  try {
    const parser = new NginxParser(site.log_path);
    const data = await parser.analyze();
    await writeYAML(data, site.data_path);
    logger.info(`Analyzed ${site.domain} successfully`);
  } catch (error) {
    logger.error(`Failed to analyze ${site.domain}:`, error);
  }
}
```

### 4. Dashboard Package (`@analytics-system/dashboard`)

**Two Deployment Modes:**

**A) Static Mode (default):**
- Pure HTML/CSS/JS
- Auth handled by HTTP Basic Auth (nginx/Caddy)
- Reads YAML files directly via fetch
- No server needed

**B) Server Mode (with auth):**
- Minimal Express server
- Session-based password auth
- Serves static files + protected endpoints
- Endpoint: `GET /api/sites` - list all sites
- Endpoint: `GET /api/data/:domain` - get site data

**UI Features:**
- Overview page: all sites summary
- Per-site drill-down: detailed charts
- Date range selector (1d, 7d, 30d, 1y, all)
- Responsive design (mobile-friendly)
- Dark/light mode toggle
- Export data as CSV

**Chart Library:**
Use lightweight vanilla JS charting (e.g., Chart.js or custom SVG)

### 5. Components Package (`@analytics-system/components`)

**Framework-Agnostic Design:**
Use Web Components (Custom Elements) for maximum compatibility

**Components:**
```javascript
// Usage in any framework
<analytics-summary data-url="/analytics/data.yaml"></analytics-summary>
<analytics-chart type="line" metric="pageviews" range="7d"></analytics-chart>
<analytics-table metric="top-pages" limit="10"></analytics-table>
<analytics-referrers limit="5"></analytics-referrers>
```

**Component API:**
- Accept `data-url` attribute or `data` prop (for SSR)
- Emit custom events for interactions
- Styling via CSS custom properties (themeable)
- Lazy load data on viewport intersection

**Example Implementation:**
```javascript
class AnalyticsSummary extends HTMLElement {
  async connectedCallback() {
    const dataUrl = this.getAttribute('data-url');
    const data = await fetch(dataUrl).then(r => r.text()).then(parseYAML);
    this.render(data);
  }
  
  render(data) {
    this.innerHTML = `
      <div class="analytics-summary">
        <div class="stat-card">
          <h3>Total Pageviews</h3>
          <p>${data.summary.total_pageviews}</p>
        </div>
        ...
      </div>
    `;
  }
}

customElements.define('analytics-summary', AnalyticsSummary);
```

## nginx Configuration

### Custom Log Format
```nginx
# /etc/nginx/conf.d/analytics-log-format.conf
log_format analytics '$remote_addr - $remote_user [$time_local] '
                     '"$request" $status $body_bytes_sent '
                     '"$http_referer" "$http_user_agent" '
                     '$request_time';
```

### Per-Site Configuration
```nginx
# Injected into each site's server block
server {
    # ... existing config
    
    access_log /var/log/nginx/example.com-analytics.log analytics;
    
    # ... rest of config
}
```

## Security Considerations

1. **Dashboard Auth:**
   - bcrypt password hashing (cost factor 12)
   - Rate limiting on login attempts
   - HTTPS only in production

2. **File Permissions:**
   - Config files: 0600 (root only)
   - Data files: 0644 (readable by web server)
   - Log files: managed by nginx/system

3. **Input Validation:**
   - Sanitize domain names (prevent path traversal)
   - Validate cron expressions
   - Escape user-agent strings in output

4. **Privacy:**
   - IP hashing (not storing raw IPs)
   - No persistent cookies/tracking
   - GDPR-friendly (all data under user control)

## Testing Strategy

### Unit Tests
- Parser: test log line parsing edge cases
- Analyzers: verify calculation accuracy
- Config: validation logic

### Integration Tests
- Full pipeline: sample logs → YAML output
- Scheduler: job execution and error handling
- Dashboard: data loading and rendering

### Manual Testing Checklist
- Setup wizard on fresh Ubuntu/Debian server
- Multi-site configuration
- Log rotation handling
- Dashboard auth flow
- Component integration in Next.js, Astro, vanilla HTML

## Development Workflow

### Package Publishing
```bash
# Publish all packages
npm run publish:all

# Individual packages
npm run publish:cli
npm run publish:parser
npm run publish:components
```

### Local Development
```bash
# Install dependencies
npm install

# Run tests
npm test

# Build all packages
npm run build

# Link for local testing
cd packages/cli && npm link
```

## Deployment Example

### Initial Setup
```bash
# Install globally
npm install -g @analytics-system/cli

# Run setup
sudo analytics-system setup

# Verify
systemctl status analytics-scheduler
```

### Adding to a Next.js Project
```bash
# In your Next.js project
npm install @analytics-system/components

# Create analytics page: app/analytics/page.js
import '@analytics-system/components';

export default function AnalyticsPage() {
  return (
    <div>
      <h1>Site Analytics</h1>
      <analytics-summary data-url="/analytics/data.yaml" />
      <analytics-chart type="line" metric="pageviews" range="30d" />
      <analytics-table metric="top-pages" limit="20" />
    </div>
  );
}
```

## Future Enhancements (Out of Scope for MVP)

- Caddy web server support
- Real-time WebSocket updates
- Custom event tracking (JS SDK)
- A/B test analysis
- Conversion funnels
- Geographic data (GeoIP)
- Bot filtering (user-agent analysis)
- Email reports
- Slack/Discord notifications
- Multi-server aggregation
- React/Vue/Svelte component wrappers

## Success Metrics

- Parse 1M log lines in <10 seconds
- YAML generation <1 second for 100k pageviews
- Dashboard loads <500ms
- Components bundle size <20KB gzipped
- Setup wizard completes in <5 minutes

---

## Build Instructions for Claude Code

1. **Initialize monorepo** with npm workspaces
2. **Start with `@analytics-system/parser`** - core functionality
3. **Then `@analytics-system/scheduler`** - daemon
4. **Then `@analytics-system/cli`** - setup wizard
5. **Then `@analytics-system/dashboard`** - central view
6. **Finally `@analytics-system/components`** - embeddable widgets

For each package:
- Set up TypeScript/JSDoc for type safety
- Include README with usage examples
- Add basic tests (Jest)
- Follow Node.js best practices

Use modern Node.js features (ESM modules, async/await). Target Node.js 18+.

