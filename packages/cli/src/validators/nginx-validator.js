/**
 * @fileoverview nginx configuration validator
 * Validates nginx configurations for analytics system compatibility
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

class NginxConfigValidator {
  constructor(options = {}) {
    this.nginxConfigPath = options.nginxConfigPath || '/etc/nginx/nginx.conf';
    this.sitesAvailableDir = options.sitesAvailableDir || '/etc/nginx/sites-available';
    this.sitesEnabledDir = options.sitesEnabledDir || '/etc/nginx/sites-enabled';
    this.confDir = options.confDir || '/etc/nginx/conf.d';
  }

  /**
   * Validate nginx syntax
   * @returns {Promise<boolean>} True if syntax is valid
   */
  async validateSyntax() {
    try {
      const { stdout, stderr } = await execAsync('nginx -t');
      
      // nginx -t outputs to stderr even on success
      const output = stderr || stdout;
      
      if (output.includes('syntax is ok') && output.includes('test is successful')) {
        return true;
      }
      
      console.error('nginx syntax errors:');
      console.error(output);
      return false;
      
    } catch (error) {
      console.error('nginx syntax validation failed:');
      console.error(error.message);
      return false;
    }
  }

  /**
   * Validate analytics-specific configuration
   * @returns {Promise<boolean>} True if analytics configuration is valid
   */
  async validateAnalyticsConfiguration() {
    const issues = [];
    
    try {
      // Check if analytics log format is defined
      const hasLogFormat = await this.checkAnalyticsLogFormat();
      if (!hasLogFormat) {
        issues.push('Analytics log format not found in nginx configuration');
      }
      
      // Check enabled sites for analytics logging
      const sitesWithAnalytics = await this.checkSitesAnalyticsLogging();
      if (sitesWithAnalytics.length === 0) {
        issues.push('No enabled sites found using analytics log format');
      }
      
      // Check log file permissions
      const logPermissionIssues = await this.checkLogFilePermissions();
      issues.push(...logPermissionIssues);
      
      // Report results
      if (issues.length === 0) {
        console.log('✅ All analytics configuration checks passed');
        return true;
      } else {
        console.log('⚠️  Analytics configuration issues:');
        issues.forEach(issue => {
          console.log(`   • ${issue}`);
        });
        
        // Provide suggestions
        console.log('\n💡 Suggestions:');
        if (!hasLogFormat) {
          console.log('   • Run: analytics-system nginx log-format');
        }
        if (sitesWithAnalytics.length === 0) {
          console.log('   • Run: analytics-system nginx site-config --interactive');
        }
        
        return false;
      }
      
    } catch (error) {
      console.error('Analytics configuration validation failed:', error.message);
      return false;
    }
  }

  /**
   * Check if analytics log format is defined
   * @returns {Promise<boolean>} True if log format is found
   */
  async checkAnalyticsLogFormat() {
    try {
      // Check main nginx.conf
      const mainConfig = await fs.readFile(this.nginxConfigPath, 'utf8');
      if (mainConfig.includes('log_format analytics')) {
        return true;
      }
      
      // Check conf.d directory
      try {
        const confFiles = await fs.readdir(this.confDir);
        for (const file of confFiles) {
          if (file.endsWith('.conf')) {
            const confContent = await fs.readFile(path.join(this.confDir, file), 'utf8');
            if (confContent.includes('log_format analytics')) {
              return true;
            }
          }
        }
      } catch (error) {
        // conf.d directory might not exist
      }
      
      return false;
      
    } catch (error) {
      console.log(`⚠️  Could not check log format: ${error.message}`);
      return false;
    }
  }

  /**
   * Check enabled sites for analytics logging
   * @returns {Promise<Array>} List of sites using analytics logging
   */
  async checkSitesAnalyticsLogging() {
    const sitesWithAnalytics = [];
    
    try {
      const enabledSites = await fs.readdir(this.sitesEnabledDir);
      
      for (const site of enabledSites) {
        try {
          const sitePath = path.join(this.sitesEnabledDir, site);
          const siteConfig = await fs.readFile(sitePath, 'utf8');
          
          if (siteConfig.includes('access_log') && siteConfig.includes('analytics')) {
            sitesWithAnalytics.push(site);
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }
      
    } catch (error) {
      console.log(`⚠️  Could not check enabled sites: ${error.message}`);
    }
    
    return sitesWithAnalytics;
  }

  /**
   * Check log file permissions
   * @returns {Promise<Array>} List of permission issues
   */
  async checkLogFilePermissions() {
    const issues = [];
    
    try {
      // Common log directories to check
      const logDirs = ['/var/log/nginx', '/var/log'];
      
      for (const logDir of logDirs) {
        try {
          const stats = await fs.stat(logDir);
          
          // Check if directory is writable (basic check)
          try {
            await fs.access(logDir, fs.constants.W_OK);
          } catch (error) {
            issues.push(`Log directory ${logDir} is not writable`);
          }
          
        } catch (error) {
          if (logDir === '/var/log/nginx') {
            issues.push('nginx log directory /var/log/nginx does not exist');
          }
        }
      }
      
    } catch (error) {
      issues.push(`Could not check log file permissions: ${error.message}`);
    }
    
    return issues;
  }

  /**
   * Reload nginx configuration
   * @returns {Promise<boolean>} True if reload successful
   */
  async reloadNginx() {
    try {
      await execAsync('nginx -s reload');
      return true;
    } catch (error) {
      console.error('nginx reload failed:', error.message);
      return false;
    }
  }

  /**
   * Get nginx status
   * @returns {Promise<Object>} nginx status information
   */
  async getNginxStatus() {
    try {
      const { stdout } = await execAsync('systemctl status nginx --no-pager');
      
      const isActive = stdout.includes('Active: active');
      const isEnabled = stdout.includes('Loaded:') && stdout.includes('enabled');
      
      return {
        active: isActive,
        enabled: isEnabled,
        status: isActive ? 'running' : 'stopped'
      };
      
    } catch (error) {
      return {
        active: false,
        enabled: false,
        status: 'unknown',
        error: error.message
      };
    }
  }

  /**
   * Validate specific site configuration
   * @param {string} siteId - Site identifier
   * @returns {Promise<Object>} Validation results
   */
  async validateSiteConfiguration(siteId) {
    const results = {
      exists: false,
      enabled: false,
      hasAnalyticsLogging: false,
      logPathExists: false,
      issues: []
    };
    
    try {
      // Check if site config exists
      const siteConfigPath = path.join(this.sitesAvailableDir, `${siteId}.conf`);
      
      try {
        const siteConfig = await fs.readFile(siteConfigPath, 'utf8');
        results.exists = true;
        
        // Check if site is enabled
        const enabledPath = path.join(this.sitesEnabledDir, `${siteId}.conf`);
        try {
          await fs.access(enabledPath);
          results.enabled = true;
        } catch (error) {
          results.issues.push('Site configuration exists but is not enabled');
        }
        
        // Check for analytics logging
        if (siteConfig.includes('access_log') && siteConfig.includes('analytics')) {
          results.hasAnalyticsLogging = true;
        } else {
          results.issues.push('Site does not use analytics log format');
        }
        
        // Extract and check log path
        const logPathMatch = siteConfig.match(/access_log\s+([^\s;]+)/);
        if (logPathMatch) {
          const logPath = logPathMatch[1];
          try {
            const logDir = path.dirname(logPath);
            await fs.access(logDir);
            results.logPathExists = true;
          } catch (error) {
            results.issues.push(`Log directory does not exist: ${path.dirname(logPath)}`);
          }
        }
        
      } catch (error) {
        results.issues.push(`Site configuration file not found: ${siteConfigPath}`);
      }
      
    } catch (error) {
      results.issues.push(`Validation failed: ${error.message}`);
    }
    
    return results;
  }
}

module.exports = { NginxConfigValidator };