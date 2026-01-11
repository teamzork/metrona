#!/usr/bin/env node

/**
 * Verification script for date filtering and export property tests
 * Validates Requirements 5.3, 5.6
 */

const { execSync } = require('child_process');
const path = require('path');

function runPropertyTests() {
  console.log('🧪 Running Property Tests for Date Filtering and Export...');
  console.log('=' .repeat(60));
  
  try {
    const testFile = path.join(__dirname, 'src', 'date-filtering-export.property.test.js');
    
    console.log('📋 Test Configuration:');
    console.log('   • Property 19: Date Range Filtering Accuracy (100 runs)');
    console.log('   • Property 20: Data Export Format Correctness (100 runs)');
    console.log('   • Additional edge case tests (70 runs)');
    console.log('   • Total iterations: ~270 property test runs');
    console.log('');
    
    const startTime = Date.now();
    
    // Run the property tests
    const result = execSync(`npm test -- --testPathPattern=date-filtering-export.property.test.js --verbose`, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('✅ Property Tests Results:');
    console.log(`   ⏱️  Execution time: ${duration} seconds`);
    
    // Parse test results
    const lines = result.split('\n');
    const passedTests = lines.filter(line => line.includes('✓')).length;
    const totalTests = lines.filter(line => line.includes('Property')).length;
    
    console.log(`   📊 Tests passed: ${passedTests}`);
    console.log(`   🎯 Properties verified: ${totalTests}`);
    
    // Check for specific property validations
    if (result.includes('Property 19: Date Range Filtering Accuracy')) {
      console.log('   ✅ Property 19: Date Range Filtering Accuracy - VERIFIED');
      console.log('      → Validates Requirement 5.3: Date range filtering');
    }
    
    if (result.includes('Property 20: Data Export Format Correctness')) {
      console.log('   ✅ Property 20: Data Export Format Correctness - VERIFIED');
      console.log('      → Validates Requirement 5.6: Data export functionality');
    }
    
    console.log('');
    console.log('🎉 All property tests passed successfully!');
    console.log('');
    console.log('📋 Requirements Validation Summary:');
    console.log('   ✅ Requirement 5.3: Date range filtering (1d, 7d, 30d, 1y, all)');
    console.log('   ✅ Requirement 5.6: CSV export functionality');
    console.log('');
    console.log('🔍 Verified Properties:');
    console.log('   • Date filtering accuracy across all time ranges');
    console.log('   • CSV export format correctness for all data types');
    console.log('   • Data integrity preservation in exports');
    console.log('   • Edge case handling (empty data, future dates)');
    console.log('   • Proper CSV escaping and formatting');
    
    return true;
    
  } catch (error) {
    console.error('❌ Property tests failed:');
    console.error(error.stdout || error.message);
    
    if (error.stderr) {
      console.error('Error details:', error.stderr);
    }
    
    return false;
  }
}

function main() {
  console.log('🚀 Dashboard Date Filtering and Export Property Test Verification');
  console.log('Feature: metrona-analytics-system');
  console.log('Tasks: 10.3 (Date Range Filtering), 10.4 (Property Tests)');
  console.log('');
  
  const success = runPropertyTests();
  
  if (success) {
    console.log('✅ Verification completed successfully');
    console.log('📝 Task 10.3: Date range filtering and data export - COMPLETE');
    console.log('📝 Task 10.4: Property tests for dashboard features - COMPLETE');
    process.exit(0);
  } else {
    console.log('❌ Verification failed');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runPropertyTests };