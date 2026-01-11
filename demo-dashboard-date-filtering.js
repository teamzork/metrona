#!/usr/bin/env node

/**
 * Demo script for testing date range filtering and CSV export functionality
 * in the Static Dashboard
 */

const { StaticDashboard } = require('./packages/dashboard/src/static-dashboard');
const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

async function createDemoData() {
  console.log('📊 Creating demo data for date filtering test...');
  
  const dataDir = './demo-dashboard-data';
  await fs.mkdir(dataDir, { recursive: true });
  
  // Generate time series data for the last 60 days
  const now = new Date();
  const dailyData = [];
  
  for (let i = 59; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    dailyData.push({
      date: date.toISOString().split('T')[0],
      pageviews: Math.floor(Math.random() * 500) + 100,
      unique_visitors: Math.floor(Math.random() * 200) + 50
    });
  }
  
  const demoData = {
    metadata: {
      site: 'demo-filtering.com',
      generated_at: new Date().toISOString()
    },
    summary: {
      total_pageviews: dailyData.reduce((sum, day) => sum + day.pageviews, 0),
      unique_visitors: Math.max(...dailyData.map(day => day.unique_visitors)),
      top_pages: [
        { path: '/', pageviews: 1500, unique_visitors: 800, percentage: 25.0 },
        { path: '/blog', pageviews: 1200, unique_visitors: 600, percentage: 20.0 },
        { path: '/about', pageviews: 800, unique_visitors: 400, percentage: 13.3 }
      ]
    },
    top_pages: [
      { path: '/', pageviews: 1500, unique_visitors: 800, percentage: 25.0 },
      { path: '/blog', pageviews: 1200, unique_visitors: 600, percentage: 20.0 },
      { path: '/about', pageviews: 800, unique_visitors: 400, percentage: 13.3 },
      { path: '/contact', pageviews: 600, unique_visitors: 300, percentage: 10.0 },
      { path: '/products', pageviews: 500, unique_visitors: 250, percentage: 8.3 }
    ],
    referrers: {
      by_domain: [
        { domain: 'google.com', visits: 2000, unique_visitors: 1200, percentage: 33.3 },
        { domain: 'facebook.com', visits: 800, unique_visitors: 500, percentage: 13.3 },
        { domain: 'twitter.com', visits: 600, unique_visitors: 400, percentage: 10.0 },
        { domain: 'direct', visits: 1500, unique_visitors: 900, percentage: 25.0 }
      ]
    },
    time_series: {
      daily: dailyData
    }
  };
  
  const yamlContent = yaml.dump(demoData);
  await fs.writeFile(path.join(dataDir, 'demo-filtering.yaml'), yamlContent, 'utf8');
  
  console.log('✅ Demo data created with 60 days of time series data');
  return demoData;
}

async function testDateFiltering() {
  console.log('\n🔍 Testing date range filtering functionality...');
  
  const dashboard = new StaticDashboard({
    dataDir: './demo-dashboard-data',
    outputDir: './demo-dashboard-output',
    sites: [
      { siteId: 'demo-filtering', domain: 'demo-filtering.com' }
    ]
  });
  
  // Load the demo data
  const data = await dashboard.loadSiteData('demo-filtering');
  console.log(`📈 Original data: ${data.time_series.daily.length} days, ${data.summary.total_pageviews} total pageviews`);
  
  // Test different date ranges
  const ranges = ['1d', '7d', '30d', '1y', 'all'];
  
  for (const range of ranges) {
    const filtered = dashboard.filterDataByDateRange(data, range);
    const days = filtered.time_series?.daily?.length || 0;
    const pageviews = filtered.summary?.total_pageviews || 0;
    
    console.log(`📅 ${range.padEnd(3)} range: ${days.toString().padStart(2)} days, ${pageviews.toString().padStart(5)} pageviews`);
  }
}

async function testCSVExport() {
  console.log('\n📄 Testing CSV export functionality...');
  
  const dashboard = new StaticDashboard({
    dataDir: './demo-dashboard-data'
  });
  const data = await dashboard.loadSiteData('demo-filtering');
  
  const exportTypes = ['summary', 'pages', 'referrers', 'timeseries'];
  
  for (const type of exportTypes) {
    try {
      const csv = dashboard.generateCSVExport(data, type);
      const lines = csv.split('\n').length - 1; // Subtract 1 for empty line at end
      console.log(`📊 ${type.padEnd(10)} export: ${lines.toString().padStart(3)} lines generated`);
      
      // Show first few lines as preview
      const preview = csv.split('\n').slice(0, 3).join('\n');
      console.log(`   Preview: ${preview.replace(/\n/g, ' | ')}`);
    } catch (error) {
      console.error(`❌ ${type} export failed:`, error.message);
    }
  }
}

async function generateDashboardWithFiltering() {
  console.log('\n🎨 Generating dashboard with date filtering controls...');
  
  const dashboard = new StaticDashboard({
    dataDir: './demo-dashboard-data',
    outputDir: './demo-dashboard-output',
    sites: [
      { siteId: 'demo-filtering', domain: 'demo-filtering.com' }
    ]
  });
  
  const result = await dashboard.generateDashboard();
  
  console.log('✅ Dashboard generated with:');
  console.log(`   📁 Output directory: ${result.outputDir}`);
  console.log(`   📄 Generated files: ${result.files.join(', ')}`);
  console.log(`   🌐 Sites included: ${result.sites.join(', ')}`);
  
  // Check if the HTML includes the new controls
  const indexPath = path.join(result.outputDir, 'demo-filtering.html');
  try {
    const htmlContent = await fs.readFile(indexPath, 'utf8');
    const hasDateControls = htmlContent.includes('date-range-controls');
    const hasExportButtons = htmlContent.includes('export-controls');
    const hasFilterFunction = htmlContent.includes('filterByDateRange');
    const hasExportFunction = htmlContent.includes('exportData');
    
    console.log('🔍 Feature verification:');
    console.log(`   📅 Date range controls: ${hasDateControls ? '✅' : '❌'}`);
    console.log(`   📤 Export buttons: ${hasExportButtons ? '✅' : '❌'}`);
    console.log(`   🔧 Filter function: ${hasFilterFunction ? '✅' : '❌'}`);
    console.log(`   📊 Export function: ${hasExportFunction ? '✅' : '❌'}`);
    
  } catch (error) {
    console.warn('⚠️  Could not verify HTML features:', error.message);
  }
}

async function main() {
  try {
    console.log('🚀 Demo: Date Range Filtering and CSV Export');
    console.log('='.repeat(50));
    
    await createDemoData();
    await testDateFiltering();
    await testCSVExport();
    await generateDashboardWithFiltering();
    
    console.log('\n🎉 Demo completed successfully!');
    console.log('📂 Check ./demo-dashboard-output/ for generated files');
    console.log('🌐 Open demo-filtering.html to test the interactive features');
    
  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { createDemoData, testDateFiltering, testCSVExport, generateDashboardWithFiltering };