#!/usr/bin/env node

/**
 * @fileoverview Dependency Detection Verification
 * Simple verification of dependency detection functionality
 * **Property 36: Dependency Detection and Messaging**
 * **Validates: Requirements 10.6**
 */

const { DependencyChecker } = require('./dependency-checker');

/**
 * Verify dependency detection works correctly
 * Tests the core property: For any system dependency, the checker should provide
 * clear detection results and helpful installation instructions
 */
async function verifyDependencyDetection() {
  console.log('🔍 Property 36: Dependency Detection and Messaging Verification');
  console.log('================================================================');

  try {
    const checker = new DependencyChecker();
    
    // Test 1: Verify all dependencies are defined
    console.log('✅ Test 1: Dependency definitions');
    if (checker.dependencies.length < 3) {
      throw new Error('Expected at least 3 dependencies (Node.js, nginx, systemd)');
    }
    
    const requiredDeps = ['Node.js', 'nginx', 'systemd'];
    const definedDeps = checker.dependencies.map(dep => dep.name);
    
    for (const required of requiredDeps) {
      if (!definedDeps.includes(required)) {
        throw new Error(`Missing required dependency: ${required}`);
      }
    }
    console.log(`   Found all required dependencies: ${definedDeps.join(', ')}`);

    // Test 2: Verify dependency structure
    console.log('✅ Test 2: Dependency structure validation');
    for (const dep of checker.dependencies) {
      if (!dep.name || !dep.command || !dep.validator || !dep.installInstructions) {
        throw new Error(`Incomplete dependency definition for: ${dep.name}`);
      }
    }
    console.log('   All dependencies have required fields');

    // Test 3: Test Node.js version validation (known working cases)
    console.log('✅ Test 3: Node.js version validation');
    
    // Test valid version
    const validResult = await checker.validateNodeVersion('v18.17.0');
    if (!validResult.valid || validResult.version !== '18.17.0') {
      throw new Error('Valid Node.js version should be accepted');
    }
    
    // Test invalid version
    const invalidResult = await checker.validateNodeVersion('v16.20.0');
    if (invalidResult.valid) {
      throw new Error('Invalid Node.js version should be rejected');
    }
    
    // Test malformed version
    const malformedResult = await checker.validateNodeVersion('invalid');
    if (malformedResult.valid || malformedResult.version !== null) {
      throw new Error('Malformed version should be handled gracefully');
    }
    
    console.log('   Node.js version validation works correctly');

    // Test 4: Test nginx version validation
    console.log('✅ Test 4: nginx version validation');
    
    const nginxResult = await checker.validateNginxVersion('nginx version: nginx/1.18.0');
    if (nginxResult.version !== '1.18.0') {
      throw new Error('nginx version parsing failed');
    }
    
    const nginxMalformed = await checker.validateNginxVersion('invalid nginx output');
    if (nginxMalformed.valid || nginxMalformed.version !== null) {
      throw new Error('Malformed nginx version should be handled gracefully');
    }
    
    console.log('   nginx version validation works correctly');

    // Test 5: Test systemd version validation
    console.log('✅ Test 5: systemd version validation');
    
    const systemdResult = await checker.validateSystemdVersion('systemd 245 (245.4-4ubuntu3.22)');
    if (!systemdResult.valid || systemdResult.version !== '245') {
      throw new Error('Valid systemd version should be accepted');
    }
    
    const oldSystemdResult = await checker.validateSystemdVersion('systemd 219');
    if (oldSystemdResult.valid) {
      throw new Error('Old systemd version should be flagged');
    }
    
    console.log('   systemd version validation works correctly');

    // Test 6: Test platform detection
    console.log('✅ Test 6: Platform detection');
    
    const platformResult = checker.checkPlatform();
    if (!platformResult.platform || typeof platformResult.supported !== 'boolean') {
      throw new Error('Platform detection should return platform and supported status');
    }
    
    console.log(`   Platform detection works: ${platformResult.platform} (${platformResult.supported ? 'supported' : 'not supported'})`);

    // Test 7: Test installation instructions
    console.log('✅ Test 7: Installation instructions');
    
    for (const dep of checker.dependencies) {
      if (!dep.installInstructions || dep.installInstructions.length < 10) {
        throw new Error(`Dependency ${dep.name} should have meaningful installation instructions`);
      }
    }
    
    console.log('   All dependencies have installation instructions');

    // Test 8: Test error handling in dependency checking
    console.log('✅ Test 8: Error handling');
    
    // Create a mock dependency that will fail
    const mockDep = {
      name: 'NonExistentTool',
      command: 'nonexistent-command-12345 --version',
      validator: async (output) => ({ valid: true, message: 'test', version: '1.0' }),
      installInstructions: 'Install from nowhere'
    };
    
    const mockResult = await checker.checkDependency(mockDep);
    if (mockResult.satisfied) {
      throw new Error('Non-existent dependency should fail gracefully');
    }
    
    if (!mockResult.installInstructions) {
      throw new Error('Failed dependency should still provide installation instructions');
    }
    
    console.log('   Error handling works correctly');

    console.log('\n🎉 Property 36 Verification PASSED');
    console.log('   - Dependency detection works correctly ✅');
    console.log('   - Version validation is accurate ✅');
    console.log('   - Error handling is robust ✅');
    console.log('   - Installation instructions are provided ✅');
    console.log('   - Platform detection works ✅');
    console.log('\n📋 Requirements 10.6 validated: Clear installation instructions provided');
    
    return true;
    
  } catch (error) {
    console.error('❌ Property 36 Verification FAILED:', error.message);
    return false;
  }
}

/**
 * Run actual dependency check to demonstrate real functionality
 */
async function demonstrateRealDependencyCheck() {
  console.log('\n🔍 Real Dependency Check Demonstration');
  console.log('=====================================');
  
  try {
    const checker = new DependencyChecker();
    const results = await checker.checkAllDependencies();
    
    console.log('Dependency Check Results:');
    results.results.forEach(result => {
      const status = result.satisfied ? '✅' : '❌';
      console.log(`${status} ${result.name}: ${result.message}`);
      
      if (!result.satisfied && result.installInstructions) {
        console.log(`   💡 ${result.installInstructions}`);
      }
    });
    
    console.log(`\nOverall Status: ${results.allPassed ? '🟢 Ready' : '🔴 Issues Found'}`);
    
  } catch (error) {
    console.log('⚠️  Real dependency check failed (this is expected in some environments)');
    console.log(`   Error: ${error.message}`);
  }
}

async function main() {
  const verificationPassed = await verifyDependencyDetection();
  await demonstrateRealDependencyCheck();
  
  if (!verificationPassed) {
    process.exit(1);
  }
  
  console.log('\n✅ Task 9.2 Complete: Dependency detection verification passed');
}

if (require.main === module) {
  main();
}

module.exports = { verifyDependencyDetection, demonstrateRealDependencyCheck };