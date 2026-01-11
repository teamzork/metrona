/**
 * @fileoverview Setup coordinator for Metrona Analytics System
 * Coordinates authentication setup and systemd service generation with rollback support
 */

const { AuthManager } = require('../utils/auth-manager');
const { SystemdServiceGenerator } = require('../generators/systemd-service');
const { NginxConfigGenerator } = require('../generators/nginx-config');
const { NginxConfigValidator } = require('../validators/nginx-validator');
const fs = require('fs').promises;
const path = require('path');

class SetupCoordinator {
  constructor(options = {}) {
    this.authManager = new AuthManager(options.auth);
    this.systemdGenerator = new SystemdServiceGenerator(options.systemd);
    this.nginxGenerator = new NginxConfigGenerator(options.nginx);
    this.nginxValidator = new NginxConfigValidator(options.nginxValidator);
    
    this.configDir = options.configDir || '/etc/analytics';
    this.dataDir = options.dataDir || '/var/analytics/data';
    this.logDir = options.logDir || '/var/log/analytics';
  }

  /**
   * Perform complete system setup with rollback support
   * @param {Object} setupConfig - Setup configuration
   * @returns {Promise<Object>} Setup result with rollback function
   */
  async performCompleteSetup(setupConfig) {
    const operations = [];
    const rollbackFunctions = [];
    
    try {
      console.log('🚀 Starting Metrona Analytics System setup...\n');
      
      // Step 1: Setup authentication if enabled
      if (setupConfig.authentication && setupConfig.authentication.enabled) {
        console.log('🔐 Setting up authentication...');
        const authResult = await this.setupAuthentication(setupConfig.authentication);
        operations.push({ type: 'authentication', result: authResult });
        rollbackFunctions.push(authResult.rollback);
        console.log('✅ Authentication setup complete\n');
      }
      
      // Step 2: Generate nginx configuration
      if (setupConfig.nginx && setupConfig.nginx.enabled) {
        console.log('🌐 Setting up nginx configuration...');
        const nginxResult = await this.setupNginxConfiguration(setupConfig.nginx);
        operations.push({ type: 'nginx', result: nginxResult });
        rollbackFunctions.push(nginxResult.rollback);
        console.log('✅ nginx configuration setup complete\n');
      }
      
      // Step 3: Generate systemd service
      if (setupConfig.systemd && setupConfig.systemd.enabled) {
        console.log('⚙️  Setting up systemd service...');
        const systemdResult = await this.setupSystemdService(setupConfig.systemd);
        operations.push({ type: 'systemd', result: systemdResult });
        rollbackFunctions.push(systemdResult.rollback);
        console.log('✅ systemd service setup complete\n');
      }
      
      // Step 4: Create initial configuration
      console.log('📝 Creating initial system configuration...');
      const configResult = await this.createInitialConfiguration(setupConfig);
      operations.push({ type: 'config', result: configResult });
      rollbackFunctions.push(configResult.rollback);
      console.log('✅ Initial configuration created\n');
      
      console.log('🎉 Setup completed successfully!');
      
      return {
        success: true,
        operations,
        rollback: async () => {
          console.log('🔄 Rolling back complete setup...');
          
          // Execute rollback functions in reverse order
          for (let i = rollbackFunctions.length - 1; i >= 0; i--) {
            try {
              await rollbackFunctions[i]();
            } catch (error) {
              console.error(`Rollback step ${i + 1} failed: ${error.message}`);
            }
          }
          
          console.log('✅ Complete setup rollback finished');
        }
      };
      
    } catch (error) {
      console.error(`❌ Setup failed: ${error.message}`);
      
      // Rollback completed operations
      for (let i = rollbackFunctions.length - 1; i >= 0; i--) {
        try {
          await rollbackFunctions[i]();
        } catch (rollbackError) {
          console.error(`Rollback step ${i + 1} failed: ${rollbackError.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Setup authentication with rollback support
   * @param {Object} authConfig - Authentication configuration
   * @returns {Promise<Object>} Authentication setup result
   */
  async setupAuthentication(authConfig) {
    const authConfigPath = path.join(this.configDir, 'auth.json');
    let configCreated = false;
    
    try {
      // Generate authentication configuration
      const config = await this.authManager.generateAuthConfig(
        authConfig.password,
        {
          sessionTimeout: authConfig.sessionTimeout,
          maxLoginAttempts: authConfig.maxLoginAttempts,
          lockoutDuration: authConfig.lockoutDuration,
          requireHttps: authConfig.requireHttps,
          secureCookies: authConfig.secureCookies,
          csrfProtection: authConfig.csrfProtection
        }
      );
      
      // Save authentication configuration
      await this.authManager.saveAuthConfig(config, authConfigPath);
      configCreated = true;
      
      return {
        success: true,
        configPath: authConfigPath,
        rollback: async () => {
          if (configCreated) {
            try {
              await fs.unlink(authConfigPath);
              console.log('✅ Authentication configuration removed');
            } catch (error) {
              if (error.code !== 'ENOENT') {
                throw error;
              }
            }
          }
        }
      };
      
    } catch (error) {
      throw new Error(`Authentication setup failed: ${error.message}`);
    }
  }

  /**
   * Setup nginx configuration with rollback support
   * @param {Object} nginxConfig - nginx configuration
   * @returns {Promise<Object>} nginx setup result
   */
  async setupNginxConfiguration(nginxConfig) {
    const backups = [];
    
    try {
      // Generate log format configuration
      const logFormat = this.nginxGenerator.generateLogFormat();
      
      // Generate site configurations
      const siteConfigs = [];
      for (const site of nginxConfig.sites || []) {
        const siteConfig = this.nginxGenerator.generateSiteConfig(site);
        siteConfigs.push({
          siteId: site.siteId,
          config: siteConfig
        });
      }
      
      // Note: Actual file writing would require root permissions
      // This setup prepares the configurations for manual installation
      
      return {
        success: true,
        logFormat,
        siteConfigs,
        rollback: async () => {
          // Rollback would restore nginx configurations
          // In practice, this would require manual intervention
          console.log('✅ nginx configuration rollback prepared (manual intervention required)');
        }
      };
      
    } catch (error) {
      throw new Error(`nginx configuration setup failed: ${error.message}`);
    }
  }

  /**
   * Setup systemd service with rollback support
   * @param {Object} systemdConfig - systemd configuration
   * @returns {Promise<Object>} systemd setup result
   */
  async setupSystemdService(systemdConfig) {
    try {
      const serviceConfig = {
        outputDir: systemdConfig.outputDir || this.dataDir,
        configPath: systemdConfig.configPath || path.join(this.configDir, 'config.yaml')
      };
      
      // Ensure systemd directory exists for testing
      await fs.mkdir(this.systemdGenerator.systemdDir, { recursive: true });
      
      const result = await this.systemdGenerator.generateServiceWithRollback(serviceConfig);
      
      return {
        success: true,
        servicePath: result.servicePath,
        userScriptPath: result.userScriptPath,
        dirScriptPath: result.dirScriptPath,
        rollback: result.rollback
      };
      
    } catch (error) {
      throw new Error(`systemd service setup failed: ${error.message}`);
    }
  }

  /**
   * Create initial system configuration
   * @param {Object} setupConfig - Setup configuration
   * @returns {Promise<Object>} Configuration creation result
   */
  async createInitialConfiguration(setupConfig) {
    const configPath = path.join(this.configDir, 'config.yaml');
    let configCreated = false;
    
    try {
      // Create configuration directory
      await fs.mkdir(this.configDir, { recursive: true });
      
      // Generate initial configuration
      const initialConfig = {
        version: 1,
        storage: {
          data_path: this.dataDir,
          backup_enabled: true,
          retention_days: 365
        },
        dashboard: {
          enabled: setupConfig.dashboard?.enabled || false,
          port: setupConfig.dashboard?.port || 3001,
          password_hash: setupConfig.authentication?.enabled ? 
            (await this.authManager.loadAuthConfig(path.join(this.configDir, 'auth.json'))).password_hash : 
            null,
          rate_limit: 10
        },
        sites: setupConfig.sites || []
      };
      
      // Write configuration file
      const yaml = require('js-yaml');
      const configYaml = yaml.dump(initialConfig, { indent: 2 });
      await fs.writeFile(configPath, configYaml, { mode: 0o600 });
      configCreated = true;
      
      console.log(`Configuration saved to: ${configPath}`);
      
      return {
        success: true,
        configPath,
        rollback: async () => {
          if (configCreated) {
            try {
              await fs.unlink(configPath);
              console.log('✅ Initial configuration removed');
            } catch (error) {
              if (error.code !== 'ENOENT') {
                throw error;
              }
            }
          }
        }
      };
      
    } catch (error) {
      throw new Error(`Initial configuration creation failed: ${error.message}`);
    }
  }

  /**
   * Validate complete setup
   * @param {Object} setupResult - Setup result to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateSetup(setupResult) {
    const validationResults = [];
    
    try {
      // Validate authentication if configured
      const authOperation = setupResult.operations.find(op => op.type === 'authentication');
      if (authOperation) {
        const authStatus = await this.authManager.checkAuthStatus(authOperation.result.configPath);
        validationResults.push({
          component: 'authentication',
          valid: authStatus.configured,
          details: authStatus
        });
      }
      
      // Validate nginx configuration if configured
      const nginxOperation = setupResult.operations.find(op => op.type === 'nginx');
      if (nginxOperation) {
        const nginxValid = await this.nginxValidator.validateAnalyticsConfiguration();
        validationResults.push({
          component: 'nginx',
          valid: nginxValid,
          details: { analyticsConfigured: nginxValid }
        });
      }
      
      // Validate systemd service if configured
      const systemdOperation = setupResult.operations.find(op => op.type === 'systemd');
      if (systemdOperation) {
        const serviceValid = await this.systemdGenerator.validateServiceFile(
          systemdOperation.result.servicePath
        );
        validationResults.push({
          component: 'systemd',
          valid: serviceValid,
          details: { serviceFileValid: serviceValid }
        });
      }
      
      const allValid = validationResults.every(result => result.valid);
      
      return {
        valid: allValid,
        results: validationResults
      };
      
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        results: validationResults
      };
    }
  }
}

module.exports = { SetupCoordinator };