#!/usr/bin/env node

/**
 * @fileoverview Demo script for Static Dashboard
 * Demonstrates dashboard generation with sample data
 */

const { StaticDashboard } = require('./packages/dashboard/src/static-dashboard');
const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

async function createSampleData() {
  console.log('📊 Creating sample analytics data...');
  
  const dataDir = './demo-dashboard-data';
  await fs.mkdir(dataDir, { recursive: true });
  
  // Sample data for example.com
  const exampleComData = {
    metadata: {
      site_id: 'example-com',
      domain: 'example.com',
      generated_at: new Date().toISOString(),
      period: {
        start: '2024-01-01T00:00:00Z',
        end: '2024-01-31T23:59:59Z'
      }
    },
    summary: {
      total_pageviews: 15420,
      unique_visitors: 8750,
      top_pages: [
        { path: '/', pageviews: 4200 },
        { path: '/about', pageviews: 2100 },
        { path: '/contact', pageviews: 1800 }
      ]
    },
    top_pages: [
      { path: '/', pageviews: 4200, unique_visitors: 2800, percentage: 27.2 },
      { path: '/about', pageviews: 2100, unique_visitors: 1650, percentage: 13.6 },
      { path: '/contact', pageviews: 1800, unique_visitors: 1200, percentage: 11.7 },
      { path: '/products', pageviews: 1500, unique_visitors: 980, percentage: 9.7 },
      { path: '/blog', pageviews: 1200, unique_visitors: 850, percentage: 7.8 },
      { path: '/pricing', pageviews: 980, unique_visitors: 720, percentage: 6.4 },
      { path: '/features', pageviews: 850, unique_visitors: 600, percentage: 5.5 },
      { path: '/support', pageviews: 720, unique_visitors: 480, percentage: 4.7 },
      { path: '/docs', pageviews: 650, unique_visitors: 420, percentage: 4.2 },
      { path: '/login', pageviews: 520, unique_visitors: 380, percentage: 3.4 }
    ],
    referrers: {
      by_domain: [
        { domain: 'google.com', visits: 3200, unique_visitors: 2100, percentage: 20.8 },
        { domain: 'facebook.com', visits: 1800, unique_visitors: 1200, percentage: 11.7 },
        { domain: 'twitter.com', visits: 1200, unique_visitors: 850, percentage: 7.8 },
        { domain: 'linkedin.com', visits: 980, unique_visitors: 720, percentage: 6.4 },
        { domain: 'reddit.com', visits: 650, unique_visitors: 480, percentage: 4.2 },
        { domain: 'github.com', visits: 520, unique_visitors: 380, percentage: 3.4 },
        { domain: 'stackoverflow.com', visits: 420, unique_visitors: 320, percentage: 2.7 },
        { domain: 'medium.com', visits: 350, unique_visitors: 280, percentage: 2.3 }
      ]
    },
    time_series: {
      daily: generateDailyData(31)
    }
  };
  
  // Sample data for blog.example.com
  const blogData = {
    metadata: {
      site_id: 'blog-example',
      domain: 'blog.example.com',
      generated_at: new Date().toISOString(),
      period: {
        start: '2024-01-01T00:00:00Z',
        end: '2024-01-31T23:59:59Z'
      }
    },
    summary: {
      total_pageviews: 8920,
      unique_visitors: 5200,
      top_pages: [
        { path: '/getting-started-guide', pageviews: 1200 },
        { path: '/best-practices', pageviews: 980 },
        { path: '/tutorials', pageviews: 850 }
      ]
    },
    top_pages: [
      { path: '/getting-started-guide', pageviews: 1200, unique_visitors: 980, percentage: 13.4 },
      { path: '/best-practices', pageviews: 980, unique_visitors: 750, percentage: 11.0 },
      { path: '/tutorials', pageviews: 850, unique_visitors: 620, percentage: 9.5 },
      { path: '/advanced-tips', pageviews: 720, unique_visitors: 520, percentage: 8.1 },
      { path: '/case-studies', pageviews: 650, unique_visitors: 480, percentage: 7.3 },
      { path: '/news', pageviews: 580, unique_visitors: 420, percentage: 6.5 },
      { path: '/reviews', pageviews: 520, unique_visitors: 380, percentage: 5.8 },
      { path: '/interviews', pageviews: 450, unique_visitors: 320, percentage: 5.0 }
    ],
    referrers: {
      by_domain: [
        { domain: 'google.com', visits: 2100, unique_visitors: 1500, percentage: 23.5 },
        { domain: 'twitter.com', visits: 980, unique_visitors: 720, percentage: 11.0 },
        { domain: 'reddit.com', visits: 850, unique_visitors: 620, percentage: 9.5 },
        { domain: 'hackernews.com', visits: 650, unique_visitors: 480, percentage: 7.3 },
        { domain: 'medium.com', visits: 520, unique_visitors: 380, percentage: 5.8 },
        { domain: 'dev.to', visits: 420, unique_visitors: 320, percentage: 4.7 }
      ]
    },
    time_series: {
      daily: generateDailyData(31, 0.6) // Lower traffic for blog
    }
  };
  
  // Write YAML files
  await fs.writeFile(
    path.join(dataDir, 'example-com.yaml'),
    yaml.dump(exampleComData, { indent: 2 }),
    'utf8'
  );
  
  await fs.writeFile(
    path.join(dataDir, 'blog-example.yaml'),
    yaml.dump(blogData, { indent: 2 }),
    'utf8'
  );
  
  console.log('✅ Sample data created in ./demo-dashboard-data/');
  return dataDir;
}

function generateDailyData(days, multiplier = 1.0) {
  const data = [];
  const baseDate = new Date('2024-01-01');
  
  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    
    // Generate realistic traffic patterns (weekends lower, some randomness)
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const weekendFactor = isWeekend ? 0.7 : 1.0;
    const randomFactor = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
    
    const basePageviews = Math.round(500 * multiplier * weekendFactor * randomFactor);
    const baseVisitors = Math.round(basePageviews * 0.65); // ~65% unique visitor rate
    
    data.push({
      date: date.toISOString().split('T')[0],
      pageviews: basePageviews,
      unique_visitors: baseVisitors
    });
  }
  
  return data;
}

async function main() {
  try {
    console.log('🎨 Static Dashboard Demo');
    console.log('========================\n');
    
    // Create sample data
    const dataDir = await createSampleData();
    
    // Configure dashboard
    const dashboard = new StaticDashboard({
      dataDir: dataDir,
      outputDir: './demo-dashboard-output',
      sites: [
        { 
          siteId: 'example-com', 
          domain: 'example.com',
          description: 'Main company website'
        },
        { 
          siteId: 'blog-example', 
          domain: 'blog.example.com',
          description: 'Company blog'
        },
        {
          siteId: 'missing-site',
          domain: 'missing.example.com',
          description: 'Site with no data (for testing error handling)'
        }
      ]
    });
    
    // Generate dashboard
    console.log('🚀 Generating static dashboard...');
    const result = await dashboard.generateDashboard();
    
    console.log('\n📊 Dashboard Generation Complete!');
    console.log('================================');
    console.log(`Output directory: ${result.outputDir}`);
    console.log(`Sites processed: ${result.sites.join(', ')}`);
    console.log(`Files generated: ${result.files.join(', ')}`);
    
    console.log('\n🌐 To view the dashboard:');
    console.log(`1. Open ${path.resolve(result.outputDir)}/index.html in your browser`);
    console.log('2. Or serve with: npx http-server demo-dashboard-output -p 3001');
    console.log('3. Then visit: http://localhost:3001');
    
    console.log('\n✨ Features demonstrated:');
    console.log('• Responsive HTML/CSS/JS dashboard interface');
    console.log('• YAML data loading and parsing');
    console.log('• Site overview with aggregate statistics');
    console.log('• Individual site detail pages');
    console.log('• Top pages and referrers tables');
    console.log('• Traffic trends visualization');
    console.log('• Error handling for missing data');
    console.log('• Mobile-responsive design');
    
  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { createSampleData, generateDailyData };