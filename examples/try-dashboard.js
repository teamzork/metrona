#!/usr/bin/env node
/**
 * Try the dashboard with the sample data in examples/data, no server setup needed:
 *
 *   node examples/try-dashboard.js        → http://localhost:3003
 *
 * No password, plain HTTP, loopback only. A real install protects it at the proxy (see Docs/setup.md).
 */

const path = require('path');
const { ServerDashboard } = require('../packages/dashboard/src/server-dashboard');

const dashboard = new ServerDashboard({
  host: '127.0.0.1',
  port: Number(process.env.PORT || 3003),
  dataDir: path.join(__dirname, 'data'),
  httpsOnly: false,
  sites: [
    { siteId: 'example-com', name: 'Example', domain: 'example.com', enabled: true },
    { siteId: 'blog-example', name: 'Example blog', domain: 'blog.example.com', enabled: true },
    { siteId: 'demo-filtering', name: 'Date filtering demo', domain: 'demo-filtering.com', enabled: true },
  ],
});

dashboard.start().then(() => {
  console.log(`Metrona sample dashboard: http://localhost:${dashboard.port}  (Ctrl+C to stop)`);
});
process.on('SIGINT', () => dashboard.stop().then(() => process.exit(0)));
