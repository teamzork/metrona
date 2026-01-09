#!/usr/bin/env node

/**
 * Demo script to showcase the AnalyticsCalculator functionality
 * Run with: node demo-analytics.js
 */

const { AnalyticsCalculator } = require('./packages/parser/src/utils/analytics-calculator');

// Sample log entries (simulating nginx access logs)
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

console.log('🚀 Metrona Analytics System Demo\n');
console.log('Processing sample log entries...\n');

// Create analytics calculator
const calculator = new AnalyticsCalculator({
  timezone: 'UTC',
  salt: 'demo-salt-2026'
});

// Process the sample data
calculator.processBatch(sampleLogEntries);

// Generate different types of analytics
console.log('📊 SUMMARY STATISTICS');
console.log('='.repeat(50));
const summary = calculator.generateSummaryStatistics();
console.log(`Total Pageviews: ${summary.totalPageviews}`);
console.log(`Unique Visitors: ${summary.uniqueVisitors}`);
console.log(`Total Pages: ${summary.totalPages}`);
console.log(`Avg Pageviews/Session: ${summary.avgPageviewsPerSession}`);
console.log(`Direct Traffic: ${summary.directTraffic}`);
console.log(`Referral Traffic: ${summary.referralTraffic}`);
console.log();

console.log('📈 TIME-SERIES DATA (Hourly)');
console.log('='.repeat(50));
const timeSeries = calculator.generateTimeSeriesData('hourly');
timeSeries.buckets.forEach(bucket => {
  const time = new Date(bucket.timestamp).toLocaleTimeString();
  console.log(`${time}: ${bucket.pageviews} pageviews, ${bucket.uniqueVisitors} unique visitors`);
});
console.log();

console.log('🏆 TOP CONTENT');
console.log('='.repeat(50));
const topContent = calculator.generateTopContentData(5);
topContent.topPages.forEach((page, index) => {
  console.log(`${index + 1}. ${page.path} - ${page.pageviews} pageviews (${page.percentage}%)`);
});
console.log();

console.log('🔗 TOP REFERRERS');
console.log('='.repeat(50));
const referrers = calculator.generateReferrerData(5, 3);
referrers.topReferrers.forEach((ref, index) => {
  console.log(`${index + 1}. ${ref.domain} - ${ref.totalReferrals} referrals (${ref.percentage}%)`);
  ref.topPaths.forEach(path => {
    console.log(`   └─ ${path.url}`);
  });
});
console.log();

console.log('📋 PROCESSING STATS');
console.log('='.repeat(50));
const stats = calculator.getStats();
console.log(`Entries Processed: ${stats.entriesProcessed}`);
console.log(`Memory Usage:`);
console.log(`  - Entries: ${stats.memoryUsage.entries}`);
console.log(`  - Visitors: ${stats.memoryUsage.visitors}`);
console.log(`  - Pages: ${stats.memoryUsage.pages}`);
console.log(`  - Referrers: ${stats.memoryUsage.referrers}`);
console.log();

console.log('✅ Demo completed! The analytics engine is working correctly.');
console.log('📁 You can find the source code in packages/parser/src/utils/analytics-calculator.js');