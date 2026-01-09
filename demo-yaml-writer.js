#!/usr/bin/env node

/**
 * Demo script to showcase the YAML dataset writer functionality
 * Run with: node demo-yaml-writer.js
 */

const { AnalyticsCalculator } = require('./packages/parser/src/utils/analytics-calculator');
const { YamlDatasetWriter } = require('./packages/parser/src/utils/yaml-writer');
const fs = require('fs').promises;

// Sample log entries for demo
const sampleLogEntries = [
  {
    ip: '192.168.1.1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    path: '/home',
    timestamp: '2026-01-08T10:00:00Z',
    method: 'GET',
    status: 200,
    bytes: 2048,
    referrer: 'https://google.com/search?q=analytics'
  },
  {
    ip: '192.168.1.2',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    path: '/about',
    timestamp: '2026-01-08T10:15:00Z',
    method: 'GET',
    status: 200,
    bytes: 1536,
    referrer: 'https://facebook.com/page'
  },
  {
    ip: '192.168.1.1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    path: '/contact',
    timestamp: '2026-01-08T10:30:00Z',
    method: 'GET',
    status: 200,
    bytes: 1024,
    referrer: '-'
  },
  {
    ip: '192.168.1.3',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
    path: '/home',
    timestamp: '2026-01-08T11:00:00Z',
    method: 'GET',
    status: 200,
    bytes: 2048,
    referrer: 'https://google.com/search?q=web+analytics'
  },
  {
    ip: '192.168.1.4',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    path: '/products',
    timestamp: '2026-01-08T11:30:00Z',
    method: 'GET',
    status: 200,
    bytes: 3072,
    referrer: 'https://twitter.com/link'
  }
];

async function runDemo() {
  console.log('🚀 Metrona YAML Dataset Writer Demo\n');

  // Create analytics calculator and process data
  console.log('📊 Processing sample log entries...');
  const calculator = new AnalyticsCalculator({
    timezone: 'UTC',
    salt: 'demo-salt-2026'
  });

  calculator.processBatch(sampleLogEntries);

  // Generate complete analytics dataset
  const analyticsData = calculator.generateCompleteDataset();

  // Create YAML writer
  const writer = new YamlDatasetWriter({
    outputDir: './demo-output',
    filePrefix: 'demo-analytics'
  });

  // Site configuration
  const siteConfig = {
    siteId: 'demo-site',
    siteName: 'Demo Website',
    domain: 'demo.example.com',
    timezone: 'UTC'
  };

  console.log('📝 Writing complete analytics dataset to YAML...');
  
  // Write initial dataset
  const outputPath = await writer.writeDataset(analyticsData, siteConfig);
  console.log(`✅ Dataset written to: ${outputPath}`);

  // Show the generated YAML content
  console.log('\n📄 Generated YAML content:');
  console.log('='.repeat(60));
  const yamlContent = await fs.readFile(outputPath, 'utf8');
  console.log(yamlContent);

  // Demonstrate incremental update
  console.log('\n🔄 Demonstrating incremental update...');
  
  // Add more sample data
  const additionalEntries = [
    {
      ip: '192.168.1.5',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      path: '/blog',
      timestamp: '2026-01-09T09:00:00Z',
      method: 'GET',
      status: 200,
      bytes: 4096,
      referrer: 'https://reddit.com/r/webdev'
    },
    {
      ip: '192.168.1.6',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      path: '/home',
      timestamp: '2026-01-09T09:30:00Z',
      method: 'GET',
      status: 200,
      bytes: 2048,
      referrer: 'https://google.com/search?q=metrona'
    }
  ];

  // Process additional data
  calculator.processBatch(additionalEntries);
  const updatedAnalytics = calculator.generateCompleteDataset();

  // Perform incremental update
  const updatedPath = await writer.updateDataset(updatedAnalytics, siteConfig);
  console.log(`✅ Dataset updated at: ${updatedPath}`);

  // Show updated metrics
  console.log('\n📈 Updated Analytics Summary:');
  console.log('='.repeat(40));
  console.log(`Total Pageviews: ${updatedAnalytics.summary.totalPageviews}`);
  console.log(`Unique Visitors: ${updatedAnalytics.summary.uniqueVisitors}`);
  console.log(`Total Pages: ${updatedAnalytics.summary.totalPages}`);
  console.log(`Direct Traffic: ${updatedAnalytics.summary.directTraffic}`);
  console.log(`Referral Traffic: ${updatedAnalytics.summary.referralTraffic}`);

  // Demonstrate time-series only export
  console.log('\n⏰ Writing time-series data only...');
  const timeSeriesPath = await writer.writeTimeSeriesData(
    updatedAnalytics.timeSeries.hourly,
    siteConfig,
    'hourly'
  );
  console.log(`✅ Time-series data written to: ${timeSeriesPath}`);

  // List all datasets
  console.log('\n📋 All generated datasets:');
  const datasets = await writer.listDatasets();
  datasets.forEach((dataset, index) => {
    console.log(`${index + 1}. ${dataset}`);
  });

  // Demonstrate reading dataset back
  console.log('\n📖 Reading dataset back from file...');
  const readData = await writer.readDataset(null, siteConfig.siteId);
  if (readData) {
    console.log(`✅ Successfully read dataset for site: ${readData.metadata.site.name}`);
    console.log(`   Generated at: ${readData.metadata.generatedAt}`);
    console.log(`   Total pageviews: ${readData.summary.totalPageviews}`);
  }

  console.log('\n🎉 Demo completed successfully!');
  console.log('📁 Check the ./demo-output directory for generated YAML files');
  console.log('🔧 You can now integrate this YAML writer into your analytics pipeline');
}

// Run the demo
runDemo().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});