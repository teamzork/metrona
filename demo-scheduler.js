#!/usr/bin/env node

/**
 * @fileoverview Demo script for the scheduler system
 */

const fs = require('fs').promises;
const path = require('path');
const { JobScheduler, JobExecutor } = require('./packages/scheduler/src');

async function createDemoLogFile() {
  const demoDir = './demo-scheduler-output';
  await fs.mkdir(demoDir, { recursive: true });
  
  const logFile = path.join(demoDir, 'demo.log');
  const sampleLogEntries = [
    '192.168.1.1 - - [08/Jan/2026:10:00:00 +0000] "GET /home HTTP/1.1" 200 2048 "https://google.com/search" "Mozilla/5.0"',
    '192.168.1.2 - - [08/Jan/2026:10:15:00 +0000] "GET /about HTTP/1.1" 200 1536 "-" "Mozilla/5.0"',
    '192.168.1.1 - - [08/Jan/2026:11:00:00 +0000] "GET /contact HTTP/1.1" 200 1024 "https://facebook.com" "Mozilla/5.0"',
    '192.168.1.3 - - [08/Jan/2026:11:30:00 +0000] "GET /products HTTP/1.1" 200 3072 "https://twitter.com" "Mozilla/5.0"',
    '192.168.1.2 - - [08/Jan/2026:12:00:00 +0000] "GET /home HTTP/1.1" 200 2048 "https://google.com/search" "Mozilla/5.0"'
  ];
  
  await fs.writeFile(logFile, sampleLogEntries.join('\n') + '\n', 'utf8');
  return logFile;
}

async function main() {
  console.log('🚀 Metrona Scheduler System Demo\n');
  
  try {
    // Create demo log file
    console.log('📝 Creating demo log file...');
    const logFile = await createDemoLogFile();
    console.log(`✅ Demo log file created: ${logFile}\n`);
    
    // Initialize scheduler and executor
    console.log('⚙️  Initializing scheduler components...');
    const scheduler = new JobScheduler({ scheduled: false }); // Don't auto-start for demo
    const executor = new JobExecutor({ outputDir: './demo-scheduler-output' });
    
    // Setup event handlers
    scheduler.on('jobStarted', (data) => {
      console.log(`🔄 Job started: ${data.jobId}`);
    });
    
    scheduler.on('jobCompleted', (data) => {
      if (data.success) {
        console.log(`✅ Job completed: ${data.jobId} (${data.duration}ms)`);
      } else {
        console.log(`❌ Job failed: ${data.jobId} - ${data.error}`);
      }
    });
    
    scheduler.on('error', (data) => {
      console.log(`⚠️  Scheduler error: ${data.error}`);
    });
    
    console.log('✅ Scheduler components initialized\n');
    
    // Create site configuration
    const siteConfig = {
      siteId: 'demo-site',
      siteName: 'Demo Website',
      domain: 'demo.example.com',
      logPath: logFile,
      timezone: 'UTC'
    };
    
    console.log('📊 Site configuration:');
    console.log(`   Site ID: ${siteConfig.siteId}`);
    console.log(`   Site Name: ${siteConfig.siteName}`);
    console.log(`   Domain: ${siteConfig.domain}`);
    console.log(`   Log Path: ${siteConfig.logPath}\n`);
    
    // Create and schedule analytics processing job
    console.log('📅 Scheduling analytics processing job...');
    const processingJob = executor.createSiteProcessingJob(siteConfig);
    
    const scheduled = scheduler.scheduleJob(
      'demo-analytics-job',
      '*/30 * * * * *', // Every 30 seconds for demo
      processingJob,
      {
        description: 'Demo analytics processing',
        context: { siteConfig }
      }
    );
    
    if (scheduled) {
      console.log('✅ Analytics job scheduled successfully\n');
    } else {
      console.log('❌ Failed to schedule analytics job\n');
      return;
    }
    
    // Create and schedule cleanup job
    console.log('🧹 Scheduling cleanup job...');
    const cleanupJob = executor.createCleanupJob({ maxAge: 1 });
    
    scheduler.scheduleJob(
      'demo-cleanup-job',
      '0 */2 * * * *', // Every 2 minutes for demo
      cleanupJob,
      { description: 'Demo cleanup job' }
    );
    
    console.log('✅ Cleanup job scheduled successfully\n');
    
    // Display scheduler status
    console.log('📈 Scheduler Status:');
    const stats = scheduler.getStats();
    console.log(`   Total Jobs: ${stats.totalJobs}`);
    console.log(`   Running Jobs: ${stats.runningJobs}`);
    console.log(`   Successful Runs: ${stats.successfulRuns}`);
    console.log(`   Failed Runs: ${stats.failedRuns}\n`);
    
    // Display all scheduled jobs
    console.log('📋 Scheduled Jobs:');
    const jobs = scheduler.getAllJobs();
    jobs.forEach(job => {
      console.log(`   ${job.jobId}: ${job.description} (${job.enabled ? 'enabled' : 'disabled'})`);
      console.log(`     Schedule: ${job.cronExpression}`);
      console.log(`     Runs: ${job.runCount} (${job.successCount} successful, ${job.errorCount} failed)`);
    });
    console.log('');
    
    // Execute jobs manually for demo
    console.log('🎬 Executing jobs manually for demonstration...\n');
    
    // Execute analytics job
    console.log('1️⃣  Executing analytics processing job...');
    await scheduler.executeJob('demo-analytics-job', processingJob, { siteConfig });
    
    // Execute cleanup job
    console.log('2️⃣  Executing cleanup job...');
    await scheduler.executeJob('demo-cleanup-job', cleanupJob, {});
    
    // Display updated statistics
    console.log('\n📊 Updated Statistics:');
    const updatedStats = scheduler.getStats();
    console.log(`   Successful Runs: ${updatedStats.successfulRuns}`);
    console.log(`   Failed Runs: ${updatedStats.failedRuns}`);
    
    const executorStats = executor.getStats();
    console.log(`   Sites Processed: ${executorStats.totalSitesProcessed}`);
    console.log(`   Log Entries Processed: ${executorStats.totalLogEntriesProcessed}`);
    
    // Display job details
    console.log('\n📋 Job Execution Details:');
    const updatedJobs = scheduler.getAllJobs();
    updatedJobs.forEach(job => {
      console.log(`   ${job.jobId}:`);
      console.log(`     Last Run: ${job.lastRun ? job.lastRun.toISOString() : 'Never'}`);
      console.log(`     Success Rate: ${job.runCount > 0 ? Math.round((job.successCount / job.runCount) * 100) : 0}%`);
      if (job.lastError) {
        console.log(`     Last Error: ${job.lastError.message}`);
      }
    });
    
    // List generated files
    console.log('\n📁 Generated Files:');
    try {
      const files = await fs.readdir('./demo-scheduler-output');
      const yamlFiles = files.filter(file => file.endsWith('.yaml') || file.endsWith('.yml'));
      yamlFiles.forEach(file => {
        console.log(`   ${file}`);
      });
    } catch (error) {
      console.log('   No files generated yet');
    }
    
    console.log('\n🎉 Demo completed successfully!');
    console.log('📁 Check the ./demo-scheduler-output directory for generated analytics files');
    console.log('🔧 The scheduler system is ready for production use');
    
    // Graceful shutdown
    console.log('\n🛑 Shutting down scheduler...');
    await scheduler.shutdown(5000);
    console.log('✅ Scheduler shut down gracefully');
    
  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    process.exit(1);
  }
}

// Run the demo
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };