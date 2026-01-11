/**
 * @fileoverview Backup and rollback management for configuration files
 * Feature: metrona-analytics-system, Requirements 3.4, 8.3
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Manages configuration backups and rollback functionality
 */
class BackupManager {
  /**
   * @param {Object} [options] - Backup manager options
   * @param {string} [options.backupDir] - Directory for storing backups
   * @param {number} [options.maxBackups=10] - Maximum number of backups to keep
   * @param {number} [options.filePermissions=0o600] - File permissions for sensitive files
   */
  constructor(options = {}) {
    this.backupDir = options.backupDir || './backups';
    this.maxBackups = options.maxBackups || 10;
    this.filePermissions = options.filePermissions || 0o600;
    
    // Track backup history
    this.backupHistory = [];
  }

  /**
   * Create a backup of the specified file
   * @param {string} filePath - Path to file to backup
   * @param {Object} [options] - Backup options
   * @param {string} [options.label] - Optional label for the backup
   * @param {Object} [options.metadata] - Additional metadata to store with backup
   * @returns {Promise<string>} Path to created backup file
   * @throws {Error} If backup creation fails
   */
  async createBackup(filePath, options = {}) {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupDir, { recursive: true });
      
      // Check if source file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error(`Source file does not exist: ${filePath}`);
        }
        throw error;
      }
      
      // Generate backup filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const basename = path.basename(filePath);
      const label = options.label ? `-${options.label}` : '';
      const backupFilename = `${basename}-backup-${timestamp}${label}`;
      const backupPath = path.join(this.backupDir, backupFilename);
      
      // Read source file
      const sourceContent = await fs.readFile(filePath, 'utf8');
      
      // Write backup file with secure permissions
      await fs.writeFile(backupPath, sourceContent, 'utf8');
      await fs.chmod(backupPath, this.filePermissions);
      
      // Create metadata file
      const metadata = {
        originalPath: filePath,
        backupPath: backupPath,
        timestamp: new Date().toISOString(),
        label: options.label || null,
        fileSize: sourceContent.length,
        checksum: this.calculateChecksum(sourceContent),
        ...options.metadata
      };
      
      const metadataPath = `${backupPath}.meta`;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      await fs.chmod(metadataPath, this.filePermissions);
      
      // Add to backup history
      this.backupHistory.push({
        originalPath: filePath,
        backupPath: backupPath,
        metadataPath: metadataPath,
        timestamp: metadata.timestamp,
        label: metadata.label
      });
      
      // Clean up old backups if necessary
      await this.cleanupOldBackups(filePath);
      
      return backupPath;
      
    } catch (error) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  /**
   * Restore a file from backup
   * @param {string} backupPath - Path to backup file
   * @param {string} [targetPath] - Target path for restoration (defaults to original path)
   * @param {Object} [options] - Restoration options
   * @param {boolean} [options.verifyChecksum=true] - Whether to verify backup integrity
   * @param {boolean} [options.createBackupBeforeRestore=true] - Create backup of current file before restore
   * @returns {Promise<string>} Path to restored file
   * @throws {Error} If restoration fails
   */
  async restoreFromBackup(backupPath, targetPath = null, options = {}) {
    const verifyChecksum = options.verifyChecksum !== false;
    const createBackupBeforeRestore = options.createBackupBeforeRestore !== false;
    
    try {
      // Check if backup file exists
      await fs.access(backupPath);
      
      // Read backup metadata
      const metadataPath = `${backupPath}.meta`;
      let metadata = null;
      
      try {
        const metadataContent = await fs.readFile(metadataPath, 'utf8');
        metadata = JSON.parse(metadataContent);
      } catch (error) {
        // Metadata file missing or corrupted, continue without verification
        console.warn(`Backup metadata not found or corrupted: ${metadataPath}`);
      }
      
      // Determine target path
      const restorePath = targetPath || (metadata ? metadata.originalPath : null);
      if (!restorePath) {
        throw new Error('Target path not specified and cannot be determined from metadata');
      }
      
      // Read backup content
      const backupContent = await fs.readFile(backupPath, 'utf8');
      
      // Verify backup integrity if metadata is available
      if (metadata && verifyChecksum) {
        const currentChecksum = this.calculateChecksum(backupContent);
        if (currentChecksum !== metadata.checksum) {
          throw new Error('Backup file integrity check failed - checksum mismatch');
        }
      }
      
      // Create backup of current file before restoration (if it exists)
      if (createBackupBeforeRestore) {
        try {
          await fs.access(restorePath);
          await this.createBackup(restorePath, {
            label: 'pre-restore',
            metadata: { restoredFrom: backupPath }
          });
        } catch (error) {
          // Target file doesn't exist, no backup needed
          if (error.code !== 'ENOENT') {
            console.warn(`Could not create pre-restore backup: ${error.message}`);
          }
        }
      }
      
      // Ensure target directory exists
      const targetDir = path.dirname(restorePath);
      await fs.mkdir(targetDir, { recursive: true });
      
      // Restore the file
      await fs.writeFile(restorePath, backupContent, 'utf8');
      await fs.chmod(restorePath, this.filePermissions);
      
      return restorePath;
      
    } catch (error) {
      throw new Error(`Failed to restore from backup: ${error.message}`);
    }
  }

  /**
   * List available backups for a file
   * @param {string} [filePath] - Original file path to filter backups (optional)
   * @returns {Promise<Array>} Array of backup information objects
   */
  async listBackups(filePath = null) {
    try {
      // Ensure backup directory exists
      try {
        await fs.access(this.backupDir);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return [];
        }
        throw error;
      }
      
      // Read backup directory
      const files = await fs.readdir(this.backupDir);
      const backups = [];
      
      // Process each metadata file
      for (const file of files) {
        if (file.endsWith('.meta')) {
          try {
            const metadataPath = path.join(this.backupDir, file);
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            const metadata = JSON.parse(metadataContent);
            
            // Filter by file path if specified
            if (filePath && metadata.originalPath !== filePath) {
              continue;
            }
            
            // Check if backup file still exists
            try {
              await fs.access(metadata.backupPath);
              backups.push(metadata);
            } catch (error) {
              // Backup file missing, skip this entry
              console.warn(`Backup file missing: ${metadata.backupPath}`);
            }
          } catch (error) {
            // Corrupted metadata file, skip
            console.warn(`Corrupted metadata file: ${file}`);
          }
        }
      }
      
      // Sort by timestamp (newest first)
      backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return backups;
      
    } catch (error) {
      throw new Error(`Failed to list backups: ${error.message}`);
    }
  }

  /**
   * Delete a specific backup
   * @param {string} backupPath - Path to backup file to delete
   * @returns {Promise<void>}
   * @throws {Error} If deletion fails
   */
  async deleteBackup(backupPath) {
    try {
      // Delete backup file
      try {
        await fs.unlink(backupPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
      
      // Delete metadata file
      const metadataPath = `${backupPath}.meta`;
      try {
        await fs.unlink(metadataPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn(`Could not delete metadata file: ${metadataPath}`);
        }
      }
      
      // Remove from backup history
      this.backupHistory = this.backupHistory.filter(
        backup => backup.backupPath !== backupPath
      );
      
    } catch (error) {
      throw new Error(`Failed to delete backup: ${error.message}`);
    }
  }

  /**
   * Clean up old backups for a specific file
   * @param {string} filePath - Original file path
   * @returns {Promise<void>}
   * @private
   */
  async cleanupOldBackups(filePath) {
    try {
      const backups = await this.listBackups(filePath);
      
      // Keep only the most recent backups
      if (backups.length > this.maxBackups) {
        const backupsToDelete = backups.slice(this.maxBackups);
        
        for (const backup of backupsToDelete) {
          try {
            await this.deleteBackup(backup.backupPath);
          } catch (error) {
            console.warn(`Could not delete old backup: ${backup.backupPath} - ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.warn(`Could not clean up old backups: ${error.message}`);
    }
  }

  /**
   * Calculate simple checksum for file integrity verification
   * @param {string} content - File content
   * @returns {string} Checksum string
   * @private
   */
  calculateChecksum(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Set secure file permissions on a file
   * @param {string} filePath - Path to file
   * @param {number} [permissions] - Octal permissions (defaults to 0o600)
   * @returns {Promise<void>}
   */
  async setSecurePermissions(filePath, permissions = null) {
    const perms = permissions || this.filePermissions;
    
    try {
      await fs.chmod(filePath, perms);
    } catch (error) {
      throw new Error(`Failed to set secure permissions on ${filePath}: ${error.message}`);
    }
  }

  /**
   * Verify file permissions are secure
   * @param {string} filePath - Path to file to check
   * @returns {Promise<boolean>} True if permissions are secure (0o600 or more restrictive)
   */
  async verifySecurePermissions(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const mode = stats.mode & parseInt('777', 8); // Get permission bits
      
      // Check if permissions are 0o600 or more restrictive
      // More restrictive means no group or other permissions
      return (mode & parseInt('077', 8)) === 0 && (mode & parseInt('200', 8)) !== 0;
      
    } catch (error) {
      throw new Error(`Failed to verify permissions for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Get backup statistics
   * @returns {Promise<Object>} Backup statistics
   */
  async getBackupStats() {
    try {
      const allBackups = await this.listBackups();
      
      // Group by original file
      const backupsByFile = {};
      let totalSize = 0;
      
      for (const backup of allBackups) {
        if (!backupsByFile[backup.originalPath]) {
          backupsByFile[backup.originalPath] = [];
        }
        backupsByFile[backup.originalPath].push(backup);
        totalSize += backup.fileSize || 0;
      }
      
      return {
        totalBackups: allBackups.length,
        filesWithBackups: Object.keys(backupsByFile).length,
        totalSizeBytes: totalSize,
        oldestBackup: allBackups.length > 0 ? allBackups[allBackups.length - 1].timestamp : null,
        newestBackup: allBackups.length > 0 ? allBackups[0].timestamp : null,
        backupsByFile: Object.fromEntries(
          Object.entries(backupsByFile).map(([file, backups]) => [
            file,
            {
              count: backups.length,
              totalSize: backups.reduce((sum, b) => sum + (b.fileSize || 0), 0),
              oldest: backups[backups.length - 1]?.timestamp,
              newest: backups[0]?.timestamp
            }
          ])
        )
      };
      
    } catch (error) {
      throw new Error(`Failed to get backup statistics: ${error.message}`);
    }
  }
}

module.exports = {
  BackupManager
};