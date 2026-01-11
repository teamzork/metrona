/**
 * @fileoverview systemd service generator for Metrona Analytics System
 * Generates systemd service files with proper permissions and configuration
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class SystemdServiceGenerator {
  constructor(options = {}) {
    this.systemdDir = options.systemdDir || '/etc/systemd/system';
    this.serviceName = options.serviceName || 'analytics-system';
    this.user = options.user || 'analytics';
    this.group = options.group || 'analytics';
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
Documentation=https://github.com/your-org/metrona-analytics-system
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
   * Write systemd service file
   * @param {Object} config - Service configuration
   * @returns {Promise<string>} Path to service file
   */
  async writeServiceFile(config) {
    const serviceContent = this.generateServiceFile(config);
    const servicePath = path.join(this.systemdDir, `${this.serviceName}.service`);
    
    try {
      await fs.writeFile(servicePath, serviceContent, 'utf8');
      await fs.chmod(servicePath, 0o644);
      
      console.log(chalk.green(`✅ Service file written to: ${servicePath}`));
      
      return servicePath;
      
    } catch (error) {
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
      
      console.log(chalk.green(`✅ User creation script written to: ${scriptPath}`));
      
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
      
      console.log(chalk.green(`✅ Directory setup script written to: ${scriptPath}`));
      
      return scriptPath;
      
    } catch (error) {
      throw new Error(`Failed to write directory setup script: ${error.message}`);
    }
  }

  /**
   * Generate complete systemd service setup
   * @param {Object} config - Service configuration
   * @returns {Promise<Object>} Generated file paths
   */
  async generateService(config) {
    try {
      // Write service file
      const servicePath = await this.writeServiceFile(config);
      
      // Write setup scripts
      const userScriptPath = await this.writeUserCreationScript();
      const dirScriptPath = await this.writeDirectorySetupScript(config);
      
      console.log(chalk.yellow('\n📋 Manual setup required:'));
      console.log(chalk.white(`1. Run user creation script: sudo ${userScriptPath}`));
      console.log(chalk.white(`2. Run directory setup script: sudo ${dirScriptPath}`));
      console.log(chalk.white('3. Reload systemd: sudo systemctl daemon-reload'));
      console.log(chalk.white(`4. Enable service: sudo systemctl enable ${this.serviceName}`));
      console.log(chalk.white(`5. Start service: sudo systemctl start ${this.serviceName}`));
      
      return {
        servicePath,
        userScriptPath,
        dirScriptPath
      };
      
    } catch (error) {
      throw new Error(`Failed to generate systemd service: ${error.message}`);
    }
  }

  /**
   * Get service management instructions
   * @returns {string} Service management instructions
   */
  getServiceInstructions() {
    return `
${chalk.blue.bold('📋 systemd Service Management')}

${chalk.yellow('Service Control:')}
  sudo systemctl start ${this.serviceName}     # Start the service
  sudo systemctl stop ${this.serviceName}      # Stop the service
  sudo systemctl restart ${this.serviceName}   # Restart the service
  sudo systemctl reload ${this.serviceName}    # Reload configuration
  sudo systemctl status ${this.serviceName}    # Check service status

${chalk.yellow('Service Configuration:')}
  sudo systemctl enable ${this.serviceName}    # Enable auto-start on boot
  sudo systemctl disable ${this.serviceName}   # Disable auto-start on boot

${chalk.yellow('Logs and Monitoring:')}
  journalctl -u ${this.serviceName}            # View service logs
  journalctl -u ${this.serviceName} -f         # Follow service logs
  journalctl -u ${this.serviceName} --since today  # Today's logs

${chalk.yellow('Configuration Reload:')}
  sudo systemctl daemon-reload                 # Reload systemd configuration
  sudo systemctl reload ${this.serviceName}    # Reload service configuration

${chalk.gray('Note: The service runs as user "' + this.user + '" for security.')}
`;
  }

  /**
   * Validate service file
   * @param {string} servicePath - Path to service file
   * @returns {Promise<boolean>} True if service file is valid
   */
  async validateServiceFile(servicePath) {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      await execAsync(`systemd-analyze verify ${servicePath}`);
      return true;
    } catch (error) {
      console.error(chalk.red('❌ Service file validation failed:'));
      console.error(chalk.red(error.message));
      return false;
    }
  }
}

module.exports = { SystemdServiceGenerator };