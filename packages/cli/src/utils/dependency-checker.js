/**
 * @fileoverview Dependency checker for Metrona Analytics System
 * Validates system requirements and provides installation guidance
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const chalk = require('chalk');

const execAsync = promisify(exec);

class DependencyChecker {
  constructor() {
    this.dependencies = [
      {
        name: 'Node.js',
        command: 'node --version',
        validator: this.validateNodeVersion.bind(this),
        installInstructions: 'Install Node.js 22+ from https://nodejs.org/'
      },
      {
        name: 'nginx',
        command: 'nginx -v',
        validator: this.validateNginxVersion.bind(this),
        installInstructions: 'Install nginx: sudo apt install nginx (Ubuntu/Debian) or sudo yum install nginx (CentOS/RHEL)'
      },
      {
        name: 'systemd',
        command: 'systemctl --version',
        validator: this.validateSystemdVersion.bind(this),
        installInstructions: 'systemd is required for service management (usually pre-installed on modern Linux)'
      }
    ];
  }

  /**
   * Check all system dependencies
   * @returns {Promise<{allPassed: boolean, results: Array}>}
   */
  async checkAllDependencies() {
    const results = [];
    
    for (const dep of this.dependencies) {
      const result = await this.checkDependency(dep);
      results.push(result);
    }
    
    const allPassed = results.every(result => result.satisfied);
    
    return {
      allPassed,
      results
    };
  }

  /**
   * Check a single dependency
   * @param {Object} dependency - Dependency configuration
   * @returns {Promise<Object>} Check result
   */
  async checkDependency(dependency) {
    try {
      const { stdout, stderr } = await execAsync(dependency.command);
      const output = stdout || stderr;
      
      const validationResult = await dependency.validator(output);
      
      return {
        name: dependency.name,
        satisfied: validationResult.valid,
        message: validationResult.message,
        version: validationResult.version,
        installInstructions: dependency.installInstructions
      };
      
    } catch (error) {
      return {
        name: dependency.name,
        satisfied: false,
        message: `Not installed or not in PATH`,
        version: null,
        installInstructions: dependency.installInstructions,
        error: error.message
      };
    }
  }

  /**
   * Validate Node.js version
   * @param {string} output - Command output
   * @returns {Object} Validation result
   */
  async validateNodeVersion(output) {
    const versionMatch = output.match(/v(\d+)\.(\d+)\.(\d+)/);
    
    if (!versionMatch) {
      return {
        valid: false,
        message: 'Could not determine Node.js version',
        version: null
      };
    }
    
    const [, major, minor, patch] = versionMatch;
    const version = `${major}.${minor}.${patch}`;
    const majorVersion = parseInt(major, 10);
    
    if (majorVersion < 22) {
      return {
        valid: false,
        message: `Node.js ${version} found, but version 22+ is required`,
        version
      };
    }
    
    return {
      valid: true,
      message: `Node.js ${version} (compatible)`,
      version
    };
  }

  /**
   * Validate nginx version
   * @param {string} output - Command output
   * @returns {Object} Validation result
   */
  async validateNginxVersion(output) {
    const versionMatch = output.match(/nginx\/(\d+\.\d+\.\d+)/);
    
    if (!versionMatch) {
      return {
        valid: false,
        message: 'Could not determine nginx version',
        version: null
      };
    }
    
    const version = versionMatch[1];
    
    // Check if nginx configuration directory exists
    try {
      await fs.access('/etc/nginx');
    } catch (error) {
      return {
        valid: false,
        message: `nginx ${version} found, but /etc/nginx directory not accessible`,
        version
      };
    }
    
    return {
      valid: true,
      message: `nginx ${version} (compatible)`,
      version
    };
  }

  /**
   * Validate systemd version
   * @param {string} output - Command output
   * @returns {Object} Validation result
   */
  async validateSystemdVersion(output) {
    const versionMatch = output.match(/systemd (\d+)/);
    
    if (!versionMatch) {
      return {
        valid: false,
        message: 'Could not determine systemd version',
        version: null
      };
    }
    
    const version = versionMatch[1];
    const versionNumber = parseInt(version, 10);
    
    if (versionNumber < 220) {
      return {
        valid: false,
        message: `systemd ${version} found, but version 220+ is recommended`,
        version
      };
    }
    
    return {
      valid: true,
      message: `systemd ${version} (compatible)`,
      version
    };
  }

  /**
   * Print dependency check results
   * @param {Object} results - Check results
   */
  printResults(results) {
    console.log(chalk.blue.bold('\n📋 Dependency Check Results\n'));
    
    results.results.forEach(result => {
      const status = result.satisfied ? 
        chalk.green('✅') : 
        chalk.red('❌');
      
      console.log(`${status} ${chalk.bold(result.name)}: ${result.message}`);
      
      if (!result.satisfied && result.installInstructions) {
        console.log(chalk.gray(`   💡 ${result.installInstructions}`));
      }
    });
    
    console.log(`\n${results.allPassed ? 
      chalk.green.bold('🟢 All dependencies satisfied') : 
      chalk.red.bold('🔴 Some dependencies are missing')}`);
  }

  /**
   * Check if running as root (needed for some operations)
   * @returns {boolean}
   */
  isRunningAsRoot() {
    return process.getuid && process.getuid() === 0;
  }

  /**
   * Check if running on supported platform
   * @returns {Object}
   */
  checkPlatform() {
    const platform = process.platform;
    const supported = ['linux'];
    
    return {
      platform,
      supported: supported.includes(platform),
      message: supported.includes(platform) ? 
        `Running on ${platform} (supported)` : 
        `Running on ${platform} (not officially supported, Linux recommended)`
    };
  }
}

module.exports = { DependencyChecker };