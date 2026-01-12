/**
 * @fileoverview Demo script for ServerDashboard
 * Tests the server-based dashboard with authentication
 */

const { ServerDashboard } = require('./packages/dashboard/src/server-dashboard');
const bcrypt = require('bcryptjs');
const path = require('path');

async function runServerDashboardDemo() {
  console.log('🚀 Starting Server Dashboard Demo...\n');

  try {
    // Create password hash for demo
    const password = 'demo-password';
    const passwordHash = await bcrypt.hash(password, 12);
    console.log('🔒 Demo password: "demo-password"');

    // Configure server dashboard
    const dashboard = new ServerDashboard({
      port: 3003,
      dataDir: path.join(__dirname, 'demo-dashboard-data'),
      passwordHash: passwordHash,
      httpsOnly: false, // Disable for demo
      rateLimit: 20, // More generous for demo
      sites: [
        {
          siteId: 'example-com',
          domain: 'example.com',
          enabled: true
        },
        {
          siteId: 'blog-example',
          domain: 'blog.example.com',
          enabled: true
        }
      ]
    });

    // Start server
    await dashboard.start();
    
    console.log('\n📊 Server Dashboard Demo Running!');
    console.log('🌐 Dashboard URL: http://localhost:3003');
    console.log('🔑 Login with password: "demo-password"');
    console.log('\n📋 Available endpoints:');
    console.log('  • GET  /              - Dashboard index (requires auth)');
    console.log('  • GET  /login         - Login page');
    console.log('  • POST /auth/login    - Login endpoint');
    console.log('  • POST /auth/logout   - Logout endpoint');
    console.log('  • GET  /auth/status   - Authentication status');
    console.log('  • GET  /api/sites     - Sites list API (requires auth)');
    console.log('  • GET  /api/data/:id  - Site data API (requires auth)');
    console.log('  • GET  /health        - Health check');
    
    console.log('\n🧪 Testing API endpoints...');
    
    // Test health endpoint
    console.log('\n1. Testing health endpoint...');
    const healthResponse = await fetch('http://localhost:3003/health');
    const healthData = await healthResponse.json();
    console.log('   ✅ Health check:', healthData.status);
    
    // Test auth status
    console.log('\n2. Testing auth status...');
    const authResponse = await fetch('http://localhost:3003/auth/status');
    const authData = await authResponse.json();
    console.log('   🔒 Auth required:', authData.authRequired);
    console.log('   👤 Authenticated:', authData.authenticated);

    console.log('\n🎯 Demo Features:');
    console.log('  ✅ Express server with session-based authentication');
    console.log('  ✅ Rate limiting for security');
    console.log('  ✅ HTTPS enforcement (disabled for demo)');
    console.log('  ✅ Protected API endpoints');
    console.log('  ✅ CSV export functionality');
    console.log('  ✅ Real-time data filtering');
    console.log('  ✅ Responsive dashboard UI');

    console.log('\n⏹️  Press Ctrl+C to stop the demo server');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down server dashboard demo...');
      await dashboard.stop();
      console.log('✅ Server stopped successfully');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    process.exit(1);
  }
}

// Run demo if called directly
if (require.main === module) {
  runServerDashboardDemo();
}

module.exports = { runServerDashboardDemo };