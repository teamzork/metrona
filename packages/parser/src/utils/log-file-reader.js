/**
 * @fileoverview Streaming log file reader with rotation support
 * Feature: metrona-analytics-system, Requirements 1.5, 1.6
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createReadStream } = require('fs');
const { createInterface } = require('readline');

/**
 * Streaming log file reader that handles log rotation and incremental processing
 */
class LogFileReader {
  /**
   * @param {string} logPath - Path to the main log file
   * @param {Object} [options] - Configuration options
   * @param {number} [options.lastPosition=0] - Last known position in the main log file
   * @param {number} [options.maxMemoryMB=64] - Maximum memory usage in MB
   * @param {string[]} [options.rotationExtensions=['.1', '.2', '.3', '.gz']] - Extensions for rotated files
   * @param {string} [options.rotationNaming='suffix'] - 'suffix' (logrotate: access.log.1, .gz) or
   *   'caddy' (Caddy's roller: access-2026-10-05T04-00-00.000.log[.gz] beside access.log)
   */
  constructor(logPath, options = {}) {
    this.logPath = logPath;
    this.lastPosition = options.lastPosition || 0;
    this.maxMemoryMB = options.maxMemoryMB || 64;
    this.rotationExtensions = options.rotationExtensions || ['.1', '.2', '.3', '.gz'];
    this.rotationNaming = options.rotationNaming || 'suffix';
    
    // Track current position for incremental processing
    this.currentPosition = this.lastPosition;
    
    // The memory limit is on what reading adds, not on the whole process: a long-running
    // scheduler (or a test runner) may already hold more than the limit before it starts.
    this.baselineHeapBytes = process.memoryUsage().heapUsed;
    
    // Memory usage tracking
    this.processedLines = 0;
    this.startTime = Date.now();
  }

  /**
   * Discover all log files including rotated ones
   * @returns {Promise<Array<{path: string, isCompressed: boolean, rotationIndex: number}>>} Array of log file info
   */
  async discoverLogFiles() {
    const logFiles = [];
    const baseDir = path.dirname(this.logPath);
    const baseName = path.basename(this.logPath);
    
    try {
      // Check if main log file exists
      if (await this.fileExists(this.logPath)) {
        logFiles.push({
          path: this.logPath,
          isCompressed: false,
          rotationIndex: 0,
          size: await this.getFileSize(this.logPath)
        });
      }
      
      if (this.rotationNaming === 'caddy') {
        logFiles.push(...await this.discoverCaddyRolledFiles(baseDir, baseName));
        logFiles.sort((a, b) => b.rotationIndex - a.rotationIndex);
        return logFiles;
      }

      // Discover rotated log files
      for (let i = 0; i < this.rotationExtensions.length; i++) {
        const ext = this.rotationExtensions[i];
        const rotatedPath = this.logPath + ext;
        
        if (await this.fileExists(rotatedPath)) {
          logFiles.push({
            path: rotatedPath,
            isCompressed: ext === '.gz',
            rotationIndex: ext === '.gz' ? 999 : parseInt(ext.substring(1)) || i + 1,
            size: await this.getFileSize(rotatedPath)
          });
        }
      }
      
      // Sort by rotation index (oldest first, then newest)
      logFiles.sort((a, b) => b.rotationIndex - a.rotationIndex);
      
      return logFiles;
    } catch (error) {
      throw new Error(`Failed to discover log files: ${error.message}`);
    }
  }

  /**
   * Files Caddy's log roller left beside the live log: `<stem>-<UTC timestamp><ext>`, optionally
   * gzipped. Named so that sorting by name is chronological.
   * @private
   */
  async discoverCaddyRolledFiles(baseDir, baseName) {
    const ext = path.extname(baseName);
    const stem = baseName.slice(0, baseName.length - ext.length);
    const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escape(stem)}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.\\d{3}${escape(ext)}(\\.gz)?$`);
    let names;
    try {
      names = await fs.promises.readdir(baseDir);
    } catch {
      return [];
    }
    const rolled = names.filter((n) => pattern.test(n)).sort();
    return Promise.all(rolled.map(async (name, i) => {
      const filePath = path.join(baseDir, name);
      return { path: filePath, isCompressed: name.endsWith('.gz'), rotationIndex: rolled.length - i, size: await this.getFileSize(filePath) };
    }));
  }

  /**
   * Stream log entries from all discovered log files
   * @param {Function} parser - Parser function that takes a line and returns a parsed entry or null
   * @returns {AsyncGenerator<Object>} Stream of parsed log entries
   */
  async *streamLogEntries(parser) {
    this.baselineHeapBytes = process.memoryUsage().heapUsed;
    const logFiles = await this.discoverLogFiles();
    
    if (logFiles.length === 0) {
      throw new Error(`No log files found for path: ${this.logPath}`);
    }
    
    // Process files in chronological order (oldest rotated files first)
    for (const logFile of logFiles) {
      yield* this.streamSingleFile(logFile, parser);
    }
  }

  /**
   * Stream entries from a single log file
   * @param {Object} logFile - Log file info object
   * @param {Function} parser - Parser function
   * @returns {AsyncGenerator<Object>} Stream of parsed entries
   * @private
   */
  async *streamSingleFile(logFile, parser) {
    let stream;
    let lineReader;
    let currentLine = 0;
    
    try {
      // Create appropriate stream based on compression
      if (logFile.isCompressed) {
        stream = createReadStream(logFile.path).pipe(zlib.createGunzip());
      } else {
        // For the main log file, start from last known position
        const startPosition = logFile.rotationIndex === 0 ? this.lastPosition : 0;
        stream = createReadStream(logFile.path, { start: startPosition });
      }
      
      // Create readline interface for line-by-line processing
      lineReader = createInterface({
        input: stream,
        crlfDelay: Infinity // Handle Windows line endings
      });
      
      // Process each line
      for await (const line of lineReader) {
        currentLine++;
        this.processedLines++;
        
        // Memory usage check
        if (this.processedLines % 1000 === 0) {
          await this.checkMemoryUsage();
        }
        
        // Skip empty lines
        if (!line.trim()) {
          continue;
        }
        
        try {
          // Parse the line
          const entry = parser(line);
          if (entry) {
            // Update position tracking for main log file
            if (logFile.rotationIndex === 0) {
              this.currentPosition += Buffer.byteLength(line, 'utf8') + 1; // +1 for newline
            }
            
            yield entry;
          }
        } catch (parseError) {
          // Log parse errors but continue processing
          console.warn(`Failed to parse line ${currentLine} in ${logFile.path}: ${parseError.message}`);
          continue;
        }
      }
      
    } catch (error) {
      throw new Error(`Failed to stream file ${logFile.path}: ${error.message}`);
    } finally {
      // Clean up resources
      if (lineReader) {
        lineReader.close();
      }
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
    }
  }

  /**
   * Get the current position in the main log file
   * @returns {number} Current byte position
   */
  getCurrentPosition() {
    return this.currentPosition;
  }

  /**
   * Reset position to start from beginning
   */
  resetPosition() {
    this.currentPosition = 0;
    this.lastPosition = 0;
  }

  /**
   * Get processing statistics
   * @returns {Object} Processing stats
   */
  getStats() {
    const elapsedMs = Date.now() - this.startTime;
    const linesPerSecond = this.processedLines / (elapsedMs / 1000);
    
    return {
      processedLines: this.processedLines,
      elapsedMs,
      linesPerSecond: Math.round(linesPerSecond),
      currentPosition: this.currentPosition,
      memoryUsageMB: this.getMemoryUsageMB()
    };
  }

  /**
   * Check if file exists
   * @param {string} filePath - Path to check
   * @returns {Promise<boolean>} True if file exists
   * @private
   */
  async fileExists(filePath) {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file size in bytes
   * @param {string} filePath - Path to file
   * @returns {Promise<number>} File size in bytes
   * @private
   */
  async getFileSize(filePath) {
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Check memory usage and throw if exceeded
   * @private
   */
  async checkMemoryUsage() {
    const memoryUsageMB = this.getMemoryUsageMB();
    
    if (memoryUsageMB > this.maxMemoryMB) {
      throw new Error(`Memory usage exceeded limit: reading grew the heap by ${memoryUsageMB}MB > ${this.maxMemoryMB}MB`);
    }
  }

  /**
   * How much the heap has grown since reading started, in MB
   * @returns {number} Memory added in MB (0 when the heap is smaller than at the start)
   * @private
   */
  getMemoryUsageMB() {
    const grown = process.memoryUsage().heapUsed - this.baselineHeapBytes;
    return Math.max(0, Math.round(grown / 1024 / 1024));
  }

  /**
   * Create a batch processor that yields arrays of entries
   * @param {Function} parser - Parser function
   * @param {number} [batchSize=1000] - Number of entries per batch
   * @returns {AsyncGenerator<Array>} Stream of entry batches
   */
  async *streamBatches(parser, batchSize = 1000) {
    let batch = [];
    
    for await (const entry of this.streamLogEntries(parser)) {
      batch.push(entry);
      
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    
    // Yield remaining entries
    if (batch.length > 0) {
      yield batch;
    }
  }

  /**
   * Process all log entries and collect them into an array
   * WARNING: This loads all entries into memory - use only for small files or testing
   * @param {Function} parser - Parser function
   * @returns {Promise<Array>} Array of all parsed entries
   */
  async collectAllEntries(parser) {
    const entries = [];
    
    for await (const entry of this.streamLogEntries(parser)) {
      entries.push(entry);
    }
    
    return entries;
  }
}

/**
 * Utility function to create a log file reader
 * @param {string} logPath - Path to log file
 * @param {Object} [options] - Reader options
 * @returns {LogFileReader} New log file reader instance
 */
function createLogFileReader(logPath, options = {}) {
  return new LogFileReader(logPath, options);
}

/**
 * Utility function to discover log files in a directory
 * @param {string} logPath - Path to main log file
 * @param {string[]} [extensions] - Extensions to look for
 * @returns {Promise<Array>} Array of discovered log files
 */
async function discoverLogFiles(logPath, extensions = ['.1', '.2', '.3', '.gz']) {
  const reader = new LogFileReader(logPath, { rotationExtensions: extensions });
  return reader.discoverLogFiles();
}

module.exports = {
  LogFileReader,
  createLogFileReader,
  discoverLogFiles
};