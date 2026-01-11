#!/usr/bin/env node

/**
 * @fileoverview Verification script for CLI security property tests
 * Runs comprehensive property-based tests for CLI security features
 */

const { runAllPropertyTests } = require('./src/security/cli-security-property-test');

async function main() {
  console.log('🔍 CLI Security Property Tests Verification');
  console.log('==========================================');
  console.log('Testing CLI security features with property-based tests...\n');

  try {
    const startTime = Date.now();
    
    // Run all property tests
    const success = await runAllPropertyTests();
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    if (success) {
      console.log(`\n🎉 All CLI security property tests PASSED in ${duration}s`);
      console.log('\n📋 Validated Requirements:');
      console.log('   - Requirements 4.3: Authentication with bcrypt and security defaults ✅');
      console.log('   - Requirements 4.5: systemd service generation with correct permissions ✅');
      console.log('   - Requirements 4.6: Error recovery and rollback functionality ✅');
      console.log('\n✅ Task 9.7 Complete: CLI security features property tests verified');
      process.exit(0);
    } else {
      console.log(`\n❌ CLI security property tests FAILED after ${duration}s`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };