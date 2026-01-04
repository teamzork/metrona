/**
 * @fileoverview Integration tests for LogFileReader with NginxLogParser
 * Feature: metrona-analytics-system, Requirements 1.5, 1.6
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { LogFileReader } = require('./log-file-reader');
const { NginxLogParser } = require('../parsers/nginx');

describe('LogFileReader Integration Tests', () => {
  let tempDir;
  let logFilePath;

  beforeEach(async () => {
    // Create temporary directory for test files
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'log-reader-test-'));
    logFilePath = path.join(tempDir, 'access.log');
  });

  afterEach(async () => {
    // Clean up temporary files
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Real file streaming', () => {
    it('should stream and parse real log entries', async () => {
      // Create test log file with sample nginx log entries
      const logEntries = [
        '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /home HTTP/1.1" 200 1234 "https://google.com" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
        '192.168.1.2 - - [04/Jan/2026:12:01:00 +0000] "GET /about HTTP/1.1" 200 5678 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"',
        '192.168.1.3 - - [04/Jan/2026:12:02:00 +0000] "GET /contact HTTP/1.1" 200 9012 "https://facebook.com" "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"',
        '192.168.1.1 - - [04/Jan/2026:12:03:00 +0000] "GET /style.css HTTP/1.1" 200 456 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
        '192.168.1.4 - - [04/Jan/2026:12:04:00 +0000] "POST /api/submit HTTP/1.1" 200 123 "-" "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15"'
      ];

      await fs.promises.writeFile(logFilePath, logEntries.join('\n') + '\n');

      // Create reader and parser
      const reader = new LogFileReader(logFilePath);
      const parser = new NginxLogParser();

      // Stream and parse entries
      const parsedEntries = [];
      for await (const entry of reader.streamLogEntries((line) => parser.parseLine(line))) {
        parsedEntries.push(entry);
      }

      // Verify results
      expect(parsedEntries).toHaveLength(5);
      
      // Check first entry
      expect(parsedEntries[0].ip).toBe('192.168.1.1');
      expect(parsedEntries[0].path).toBe('/home');
      expect(parsedEntries[0].status).toBe(200);
      expect(parsedEntries[0].referrer).toBe('https://google.com');

      // Check that position tracking works
      expect(reader.getCurrentPosition()).toBeGreaterThan(0);

      // Verify stats
      const stats = reader.getStats();
      expect(stats.processedLines).toBe(5);
      expect(stats.linesPerSecond).toBeGreaterThan(0);
    });

    it('should handle incremental processing from last position', async () => {
      // Create initial log file
      const initialEntries = [
        '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /home HTTP/1.1" 200 1234 "-" "Mozilla/5.0"',
        '192.168.1.2 - - [04/Jan/2026:12:01:00 +0000] "GET /about HTTP/1.1" 200 5678 "-" "Mozilla/5.0"'
      ];

      await fs.promises.writeFile(logFilePath, initialEntries.join('\n') + '\n');

      // First processing run
      const reader1 = new LogFileReader(logFilePath);
      const parser = new NginxLogParser();

      const firstRun = [];
      for await (const entry of reader1.streamLogEntries((line) => parser.parseLine(line))) {
        firstRun.push(entry);
      }

      expect(firstRun).toHaveLength(2);
      const lastPosition = reader1.getCurrentPosition();
      expect(lastPosition).toBeGreaterThan(0);

      // Append new entries to the log file
      const newEntries = [
        '192.168.1.3 - - [04/Jan/2026:12:02:00 +0000] "GET /contact HTTP/1.1" 200 9012 "-" "Mozilla/5.0"',
        '192.168.1.4 - - [04/Jan/2026:12:03:00 +0000] "GET /products HTTP/1.1" 200 3456 "-" "Mozilla/5.0"'
      ];

      await fs.promises.appendFile(logFilePath, newEntries.join('\n') + '\n');

      // Second processing run starting from last position
      const reader2 = new LogFileReader(logFilePath, { lastPosition });

      const secondRun = [];
      for await (const entry of reader2.streamLogEntries((line) => parser.parseLine(line))) {
        secondRun.push(entry);
      }

      // Should only process the new entries
      expect(secondRun).toHaveLength(2);
      expect(secondRun[0].path).toBe('/contact');
      expect(secondRun[1].path).toBe('/products');
    });

    it('should handle log rotation files', async () => {
      // Create main log file
      const mainEntries = [
        '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /home HTTP/1.1" 200 1234 "-" "Mozilla/5.0"'
      ];
      await fs.promises.writeFile(logFilePath, mainEntries.join('\n') + '\n');

      // Create rotated log file (.1)
      const rotatedEntries = [
        '192.168.1.2 - - [03/Jan/2026:23:59:00 +0000] "GET /old-page HTTP/1.1" 200 5678 "-" "Mozilla/5.0"'
      ];
      const rotatedPath = logFilePath + '.1';
      await fs.promises.writeFile(rotatedPath, rotatedEntries.join('\n') + '\n');

      // Create compressed rotated log file (.gz)
      const compressedEntries = [
        '192.168.1.3 - - [03/Jan/2026:23:58:00 +0000] "GET /very-old-page HTTP/1.1" 200 9012 "-" "Mozilla/5.0"'
      ];
      const compressedPath = logFilePath + '.gz';
      const compressed = zlib.gzipSync(compressedEntries.join('\n') + '\n');
      await fs.promises.writeFile(compressedPath, compressed);

      // Create reader and parser
      const reader = new LogFileReader(logFilePath);
      const parser = new NginxLogParser();

      // Stream all entries (should process in chronological order: .gz, .1, main)
      const allEntries = [];
      for await (const entry of reader.streamLogEntries((line) => parser.parseLine(line))) {
        allEntries.push(entry);
      }

      // Should process all files
      expect(allEntries).toHaveLength(3);
      
      // Verify chronological order (oldest first)
      expect(allEntries[0].path).toBe('/very-old-page'); // from .gz file
      expect(allEntries[1].path).toBe('/old-page');      // from .1 file
      expect(allEntries[2].path).toBe('/home');          // from main file

      // Verify file discovery
      const discoveredFiles = await reader.discoverLogFiles();
      expect(discoveredFiles).toHaveLength(3);
      
      const filePaths = discoveredFiles.map(f => f.path);
      expect(filePaths).toContain(logFilePath);
      expect(filePaths).toContain(rotatedPath);
      expect(filePaths).toContain(compressedPath);
    });

    it('should process large files in batches without memory issues', async () => {
      // Create a larger log file (1000 entries)
      const logEntries = [];
      for (let i = 0; i < 1000; i++) {
        const timestamp = new Date(2026, 0, 1, 12, Math.floor(i / 60), i % 60);
        const formattedTime = timestamp.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
        logEntries.push(
          `192.168.1.${(i % 254) + 1} - - [04/Jan/2026:${String(12 + Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor((i % 3600) / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')} +0000] "GET /page-${i} HTTP/1.1" 200 ${1000 + i} "-" "Mozilla/5.0"`
        );
      }

      await fs.promises.writeFile(logFilePath, logEntries.join('\n') + '\n');

      // Create reader with small memory limit to test streaming behavior
      const reader = new LogFileReader(logFilePath, { maxMemoryMB: 128 });
      const parser = new NginxLogParser();

      // Process in batches
      let totalProcessed = 0;
      let batchCount = 0;

      for await (const batch of reader.streamBatches((line) => parser.parseLine(line), 100)) {
        batchCount++;
        totalProcessed += batch.length;
        
        // Verify batch size (should be 100 except possibly the last batch)
        expect(batch.length).toBeLessThanOrEqual(100);
        expect(batch.length).toBeGreaterThan(0);
        
        // Verify entries are valid
        batch.forEach(entry => {
          expect(entry.ip).toMatch(/^192\.168\.1\.\d+$/);
          expect(entry.path).toMatch(/^\/page-\d+$/);
          expect(entry.status).toBe(200);
        });
      }

      expect(totalProcessed).toBe(1000);
      expect(batchCount).toBe(10); // 1000 entries / 100 per batch

      // Verify memory usage stayed reasonable
      const stats = reader.getStats();
      expect(stats.processedLines).toBe(1000);
      expect(stats.memoryUsageMB).toBeLessThan(128); // Should stay under limit
    });

    it('should handle malformed log entries gracefully', async () => {
      // Create log file with mix of valid and invalid entries
      const logEntries = [
        '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /home HTTP/1.1" 200 1234 "-" "Mozilla/5.0"', // valid
        'this is not a valid log entry', // invalid
        '', // empty line
        '192.168.1.2 - - [04/Jan/2026:12:01:00 +0000] "GET /about HTTP/1.1" 200 5678 "-" "Mozilla/5.0"', // valid
        'another invalid entry without proper format', // invalid
        '192.168.1.3 - - [04/Jan/2026:12:02:00 +0000] "GET /contact HTTP/1.1" 200 9012 "-" "Mozilla/5.0"' // valid
      ];

      await fs.promises.writeFile(logFilePath, logEntries.join('\n') + '\n');

      const reader = new LogFileReader(logFilePath);
      const parser = new NginxLogParser();

      const validEntries = [];
      for await (const entry of reader.streamLogEntries((line) => parser.parseLine(line))) {
        validEntries.push(entry);
      }

      // Should only get the valid entries (invalid entries return null and are filtered out)
      expect(validEntries).toHaveLength(3);
      expect(validEntries[0].path).toBe('/home');
      expect(validEntries[1].path).toBe('/about');
      expect(validEntries[2].path).toBe('/contact');

      // Verify that the reader processed all lines (including invalid ones)
      const stats = reader.getStats();
      expect(stats.processedLines).toBe(6); // All lines were processed, even invalid ones
    });
  });
});