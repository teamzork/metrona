/**
 * @fileoverview `metrona demo`: the dashboard on bundled sample data, nothing to configure.
 */

const path = require('path');

const SAMPLE_SITES = [
  { siteId: 'example-com', name: 'Example', domain: 'example.com', enabled: true },
  { siteId: 'blog-example', name: 'Example blog', domain: 'blog.example.com', enabled: true },
  { siteId: 'demo-filtering', name: 'Date filtering demo', domain: 'demo-filtering.com', enabled: true },
];

async function demo({ port, host }) {
  const { ServerDashboard } = require('@metrona/dashboard');
  const dashboard = new ServerDashboard({
    host,
    port: Number(port),
    dataDir: path.join(__dirname, '../../demo-data'),
    httpsOnly: false,
    sites: SAMPLE_SITES,
  });
  await dashboard.start();
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`\nMetrona demo, on sample data: http://${shown}:${dashboard.port}  (Ctrl+C to stop)\n`);
  const stop = () => dashboard.stop().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { demo, SAMPLE_SITES };
