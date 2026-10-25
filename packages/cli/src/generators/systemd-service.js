/**
 * @fileoverview systemd service generator for Metrona Analytics System
 * Generates systemd service files with proper permissions and configuration
 */

const fs = require('fs').promises;
const path = require('path');

class SystemdServiceGenerator {
  constructor(options = {}) {
    this.systemdDir = options.systemdDir || '/etc/systemd/system';
    this.serviceName = options.serviceName || 'metrona';
    this.user = options.user || 'analytics';
    this.group = options.group || 'analytics';
    this.backupDir = options.backupDir || '/tmp/systemd-backups';
  }

  /**
   * Generate systemd service file content
   * @param {Object} config - Service configuration
   * @returns {string} Service file content
   */
  generateServiceFile(config) {
    const nodeExecutable = process.execPath;
    const schedulerPath = path.resolve(__dirname, '../../../scheduler/src/daemon.js');
    
    return `[Unit]
Description=Metrona Analytics System
Documentation=https://github.com/teamzork/metrona
After=network.target nginx.service
Wants=nginx.service

[Service]
Type=simple
User=${this.user}
Group=${this.group}
WorkingDirectory=${config.outputDir}
Environment=NODE_ENV=production
Environment=CONFIG_PATH=${config.configPath}
ExecStart=${nodeExecutable} ${schedulerPath} --config ${config.configPath}
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${this.serviceName}

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${config.outputDir}
ReadOnlyPaths=${path.dirname(config.configPath)}

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

# Graceful shutdown
TimeoutStopSec=30
KillMode=mixed
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target`;
  }

  /**
   * Create backup of existing service file
   * @param {string} servicePath - Path to service file
   * @returns {Promise<string|null>} Path to backup file or null if no backup needed
   */
  async createServiceBackup(servicePath) {
    try {
      // Check if service file exists
      await fs.access(servicePath);
      
      // Create backup directory
      await fs.mkdir(this.backupDir, { recursive: true });
      
      // Generate backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilename = `${this.serviceName}.service.backup.${timestamp}`;
      const backupPath = path.join(this.backupDir, backupFilename);
      
      // Copy existing service file to backup
      await fs.copyFile(servicePath, backupPath);
      
      console.log(`✅ Service file backed up to: ${backupPath}`);
      return backupPath;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Service file doesn't exist, no backup needed
        return null;
      }
      throw new Error(`Failed to create service backup: ${error.message}`);
    }
  }

  /**
   * Restore service file from backup
   * @param {string} backupPath - Path to backup file
   * @param {string} servicePath - Path to service file
   * @returns {Promise<void>}
   */
  async restoreServiceFromBackup(backupPath, servicePath) {
    try {
      if (!backupPath) {
        // No backup exists, remove the service file
        try {
          await fs.unlink(servicePath);
          console.log(`✅ Service file removed: ${servicePath}`);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
        return;
      }
      
      // Restore from backup
      await fs.copyFile(backupPath, servicePath);
      console.log(`✅ Service file restored from backup: ${backupPath}`);
      
    } catch (error) {
      throw new Error(`Failed to restore service from backup: ${error.message}`);
    }
  }

  /**
   * Generate user creation script
   * @returns {string} User creation script
   */
  generateUserCreationScript() {
    return `#!/bin/bash
# Create analytics system user and group

set -e

# Create group if it doesn't exist
if ! getent group ${this.group} > /dev/null 2>&1; then
    echo "Creating group: ${this.group}"
    groupadd --system ${this.group}
fi

# Create user if it doesn't exist
if ! getent passwd ${this.user} > /dev/null 2>&1; then
    echo "Creating user: ${this.user}"
    useradd --system --gid ${this.group} --home-dir /var/lib/${this.serviceName} \\
            --shell /bin/false --comment "Metrona Analytics System" ${this.user}
fi

echo "User and group created successfully"`;
  }

  /**
   * Generate directory setup script
   * @param {Object} config - Service configuration
   * @returns {string} Directory setup script
   */
  generateDirectorySetupScript(config) {
    return `#!/bin/bash
# Set up directories and permissions for analytics system

set -e

# Create directories
mkdir -p ${config.outputDir}
mkdir -p $(dirname ${config.configPath})
mkdir -p /var/log/${this.serviceName}

# Set ownership
chown -R ${this.user}:${this.group} ${config.outputDir}
chown -R ${this.user}:${this.group} /var/log/${this.serviceName}
chown ${this.user}:${this.group} $(dirname ${config.configPath})

# Set permissions
chmod 755 ${config.outputDir}
chmod 755 $(dirname ${config.configPath})
chmod 755 /var/log/${this.serviceName}

# Set config file permissions (if it exists)
if [ -f ${config.configPath} ]; then
    chown ${this.user}:${this.group} ${config.configPath}
    chmod 600 ${config.configPath}
fi

echo "Directories and permissions set up successfully"`;
  }

  /**
   * Write systemd service file with rollback support
   * @param {Object} config - Service configuration
   * @returns {Promise<Object>} Operation result with rollback info
   */
  async writeServiceFileWithRollback(config) {
    const servicePath = path.join(this.systemdDir, `${this.serviceName}.service`);
    let backupPath = null;
    
    try {
      // Create backup of existing service file
      backupPath = await this.createServiceBackup(servicePath);
      
      // Generate new service content
      const serviceContent = this.generateServiceFile(config);
      
      // Write new service file with secure permissions
      await fs.writeFile(servicePath, serviceContent, { mode: 0o644 });
      
      console.log(`✅ Service file written to: ${servicePath}`);
      
      return {
        success: true,
        servicePath,
        backupPath,
        rollback: async () => {
          await this.restoreServiceFromBackup(backupPath, servicePath);
        }
      };
      
    } catch (error) {
      // If writing failed and we have a backup, restore it
      if (backupPath) {
        try {
          await this.restoreServiceFromBackup(backupPath, servicePath);
        } catch (restoreError) {
          console.error(`Failed to restore backup: ${restoreError.message}`);
        }
      }
      
      throw new Error(`Failed to write service file: ${error.message}`);
    }
  }

  /**
   * Write user creation script
   * @returns {Promise<string>} Path to script
   */
  async writeUserCreationScript() {
    const scriptContent = this.generateUserCreationScript();
    const scriptPath = `/tmp/create-${this.serviceName}-user.sh`;
    
    try {
      await fs.writeFile(scriptPath, scriptContent, 'utf8');
      await fs.chmod(scriptPath, 0o755);
      
      console.log(`✅ User creation script written to: ${scriptPath}`);
      
      return scriptPath;
      
    } catch (error) {
      throw new Error(`Failed to write user creation script: ${error.message}`);
    }
  }

  /**
   * Write directory setup script
   * @param {Object} config - Service configuration
   * @returns {Promise<string>} Path to script
   */
  async writeDirectorySetupScript(config) {
    const scriptContent = this.generateDirectorySetupScript(config);
    const scriptPath = `/tmp/setup-${this.serviceName}-dirs.sh`;
    
    try {
      await fs.writeFile(scriptPath, scriptContent, 'utf8');
      await fs.chmod(scriptPath, 0o755);
      
      console.log(`✅ Directory setup script written to: ${scriptPath}`);
      
      return scriptPath;
      
    } catch (error) {
      throw new Error(`Failed to write directory setup script: ${error.message}`);
    }
  }

  /**
   * Generate complete systemd service setup with rollback support
   * @param {Object} config - Service configuration
   * @returns {Promise<Object>} Generated file paths and rollback function
   */
  async generateServiceWithRollback(config) {
    const operations = [];
    
    try {
      // Write service file with rollback support
      const serviceResult = await this.writeServiceFileWithRollback(config);
      operations.push(serviceResult);
      
      // Write setup scripts
      const userScriptPath = await this.writeUserCreationScript();
      const dirScriptPath = await this.writeDirectorySetupScript(config);
      
      console.log('\n📋 Manual setup required:');
      console.log(`1. Run user creation script: sudo ${userScriptPath}`);
      console.log(`2. Run directory setup script: sudo ${dirScriptPath}`);
      console.log('3. Reload systemd: sudo systemctl daemon-reload');
      console.log(`4. Enable service: sudo systemctl enable ${this.serviceName}`);
      console.log(`5. Start service: sudo systemctl start ${this.serviceName}`);
      
      return {
        success: true,
        servicePath: serviceResult.servicePath,
        userScriptPath,
        dirScriptPath,
        backupPath: serviceResult.backupPath,
        rollback: async () => {
          console.log('🔄 Rolling back systemd service setup...');
          
          // Rollback service file
          await serviceResult.rollback();
          
          // Clean up script files
          try {
            await fs.unlink(userScriptPath);
            await fs.unlink(dirScriptPath);
            console.log('✅ Setup scripts cleaned up');
          } catch (error) {
            console.warn(`Warning: Could not clean up scripts: ${error.message}`);
          }
          
          console.log('✅ Systemd service setup rolled back');
        }
      };
      
    } catch (error) {
      // Rollback any completed operations
      for (const operation of operations) {
        if (operation.rollback) {
          try {
            await operation.rollback();
          } catch (rollbackError) {
            console.error(`Rollback failed: ${rollbackError.message}`);
          }
        }
      }
      
      throw new Error(`Failed to generate systemd service: ${error.message}`);
    }
  }

  /**
   * Get service management instructions
   * @returns {string} Service management instructions
   */
  getServiceInstructions() {
    return `
📋 systemd Service Management

Service Control:
  sudo systemctl start ${this.serviceName}     # Start the service
  sudo systemctl stop ${this.serviceName}      # Stop the service
  sudo systemctl restart ${this.serviceName}   # Restart the service
  sudo systemctl reload ${this.serviceName}    # Reload configuration
  sudo systemctl status ${this.serviceName}    # Check service status

Service Configuration:
  sudo systemctl enable ${this.serviceName}    # Enable auto-start on boot
  sudo systemctl disable ${this.serviceName}   # Disable auto-start on boot

Logs and Monitoring:
  journalctl -u ${this.serviceName}            # View service logs
  journalctl -u ${this.serviceName} -f         # Follow service logs
  journalctl -u ${this.serviceName} --since today  # Today's logs

Configuration Reload:
  sudo systemctl daemon-reload                 # Reload systemd configuration
  sudo systemctl reload ${this.serviceName}    # Reload service configuration

Note: The service runs as user "${this.user}" for security.
`;
  }

  /**
   * Validate service file
   * @param {string} servicePath - Path to service file
   * @returns {Promise<boolean>} True if service file is valid
   */
  async validateServiceFile(servicePath) {
    try {
      // Check if systemd-analyze is available (Linux only)
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      await execAsync('which systemd-analyze');
      
      // If available, use systemd-analyze for validation
      await execAsync(`systemd-analyze verify ${servicePath}`);
      return true;
      
    } catch (error) {
      // If systemd-analyze is not available (e.g., on macOS), do basic validation
      try {
        const content = await fs.readFile(servicePath, 'utf8');
        
        // Check for required sections
        const requiredSections = ['[Unit]', '[Service]', '[Install]'];
        for (const section of requiredSections) {
          if (!content.includes(section)) {
            console.error(`❌ Service file missing required section: ${section}`);
            return false;
          }
        }
        
        // Check for required fields
        const requiredFields = [
          'Description=',
          'ExecStart=',
          'Type=',
          'WantedBy='
        ];
        for (const field of requiredFields) {
          if (!content.includes(field)) {
            console.error(`❌ Service file missing required field: ${field}`);
            return false;
          }
        }
        
        return true;
        
      } catch (readError) {
        console.error('❌ Service file validation failed:', readError.message);
        return false;
      }
    }
  }
}

module.exports = { SystemdServiceGenerator };