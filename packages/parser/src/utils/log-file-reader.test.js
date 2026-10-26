/**
 * @fileoverview Unit tests for streaming log file reader
 * Feature: metrona-analytics-system, Requirements 1.5, 1.6
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { LogFileReader, createLogFileReader, discoverLogFiles } = require('./log-file-reader');

// Mock file system for testing
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    stat: jest.fn()
  },
  constants: {
    F_OK: 0
  },
  createReadStream: jest.fn()
}));

jest.mock('zlib', () => ({
  createGunzip: jest.fn()
}));

jest.mock('readline', () => ({
  createInterface: jest.fn()
}));

describe('LogFileReader', () => {
  let mockReadStream;
  let mockGunzip;
  let mockReadlineInterface;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock readline interface
    mockReadlineInterface = {
      [Symbol.asyncIterator]: jest.fn(),
      close: jest.fn()
    };
    
    // Mock read stream
    mockReadStream = {
      pipe: jest.fn().mockReturnThis(),
      destroy: jest.fn()
    };
    
    // Mock gunzip stream
    mockGunzip = {
      destroy: jest.fn()
    };
    
    require('fs').createReadStream.mockReturnValue(mockReadStream);
    require('zlib').createGunzip.mockReturnValue(mockGunzip);
    require('readline').createInterface.mockReturnValue(mockReadlineInterface);
  });

  describe('constructor', () => {
    it('should create reader with default options', () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      expect(reader.logPath).toBe('/var/log/nginx/access.log');
      expect(reader.lastPosition).toBe(0);
      expect(reader.maxMemoryMB).toBe(64);
      expect(reader.rotationExtensions).toEqual(['.1', '.2', '.3', '.gz']);
    });

    it('should create reader with custom options', () => {
      const options = {
        lastPosition: 1024,
        maxMemoryMB: 128,
        rotationExtensions: ['.1', '.gz']
      };
      
      const reader = new LogFileReader('/var/log/nginx/access.log', options);
      
      expect(reader.lastPosition).toBe(1024);
      expect(reader.maxMemoryMB).toBe(128);
      expect(reader.rotationExtensions).toEqual(['.1', '.gz']);
    });
  });

  describe('discoverLogFiles', () => {
    it('should discover main log file only', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      // Mock file existence checks
      fs.promises.access
        .mockResolvedValueOnce() // main file exists
        .mockRejectedValue(new Error('File not found')); // rotated files don't exist
      
      fs.promises.stat.mockResolvedValue({ size: 1024 });
      
      const files = await reader.discoverLogFiles();
      
      expect(files).toHaveLength(1);
      expect(files[0]).toEqual({
        path: '/var/log/nginx/access.log',
        isCompressed: false,
        rotationIndex: 0,
        size: 1024
      });
    });

    it('should discover main file and rotated files', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      // Mock file existence checks
      fs.promises.access
        .mockResolvedValueOnce() // main file exists
        .mockResolvedValueOnce() // .1 exists
        .mockRejectedValueOnce(new Error('File not found')) // .2 doesn't exist
        .mockRejectedValueOnce(new Error('File not found')) // .3 doesn't exist
        .mockResolvedValueOnce(); // .gz exists
      
      fs.promises.stat
        .mockResolvedValueOnce({ size: 1024 }) // main file
        .mockResolvedValueOnce({ size: 2048 }) // .1 file
        .mockResolvedValueOnce({ size: 512 }); // .gz file
      
      const files = await reader.discoverLogFiles();
      
      expect(files).toHaveLength(3);
      
      // Should be sorted by rotation index (oldest first)
      expect(files[0].rotationIndex).toBe(999); // .gz file (oldest)
      expect(files[1].rotationIndex).toBe(1);   // .1 file
      expect(files[2].rotationIndex).toBe(0);   // main file (newest)
    });

    it('should return empty array when no files exist', async () => {
      const reader = new LogFileReader('/nonexistent/path/access.log');
      
      fs.promises.access.mockRejectedValue(new Error('File not found'));
      
      const files = await reader.discoverLogFiles();
      expect(files).toEqual([]);
    });
  });

  describe('streamLogEntries', () => {
    it('should stream entries from single file', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      // Mock file discovery
      jest.spyOn(reader, 'discoverLogFiles').mockResolvedValue([
        {
          path: '/var/log/nginx/access.log',
          isCompressed: false,
          rotationIndex: 0,
          size: 1024
        }
      ]);
      
      // Mock readline interface to yield test lines
      const testLines = [
        '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /test HTTP/1.1" 200 1234 "-" "Mozilla/5.0"',
        '192.168.1.2 - - [04/Jan/2026:12:01:00 +0000] "GET /home HTTP/1.1" 200 5678 "-" "Mozilla/5.0"'
      ];
      
      mockReadlineInterface[Symbol.asyncIterator] = async function* () {
        for (const line of testLines) {
          yield line;
        }
      };
      
      // Mock parser function
      const mockParser = jest.fn()
        .mockReturnValueOnce({ path: '/test', status: 200 })
        .mockReturnValueOnce({ path: '/home', status: 200 });
      
      const entries = [];
      for await (const entry of reader.streamLogEntries(mockParser)) {
        entries.push(entry);
      }
      
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ path: '/test', status: 200 });
      expect(entries[1]).toEqual({ path: '/home', status: 200 });
      expect(mockParser).toHaveBeenCalledTimes(2);
    });

    it('should handle compressed files', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      // Mock file discovery with compressed file
      jest.spyOn(reader, 'discoverLogFiles').mockResolvedValue([
        {
          path: '/var/log/nginx/access.log.gz',
          isCompressed: true,
          rotationIndex: 999,
          size: 512
        }
      ]);
      
      mockReadlineInterface[Symbol.asyncIterator] = async function* () {
        yield '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /test HTTP/1.1" 200 1234 "-" "Mozilla/5.0"';
      };
      
      const mockParser = jest.fn().mockReturnValue({ path: '/test', status: 200 });
      
      const entries = [];
      for await (const entry of reader.streamLogEntries(mockParser)) {
        entries.push(entry);
      }
      
      expect(entries).toHaveLength(1);
      expect(mockReadStream.pipe).toHaveBeenCalledWith(mockGunzip);
    });

    it('should skip empty lines and handle parse errors', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      jest.spyOn(reader, 'discoverLogFiles').mockResolvedValue([
        {
          path: '/var/log/nginx/access.log',
          isCompressed: false,
          rotationIndex: 0,
          size: 1024
        }
      ]);
      
      const testLines = [
        '', // empty line
        'invalid log line', // will cause parse error
        '192.168.1.1 - - [04/Jan/2026:12:00:00 +0000] "GET /test HTTP/1.1" 200 1234 "-" "Mozilla/5.0"' // valid line
      ];
      
      mockReadlineInterface[Symbol.asyncIterator] = async function* () {
        for (const line of testLines) {
          yield line;
        }
      };
      
      const mockParser = jest.fn()
        .mockImplementationOnce(() => { throw new Error('Parse error'); })
        .mockReturnValueOnce({ path: '/test', status: 200 });
      
      // Mock console.warn to avoid test output
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const entries = [];
      for await (const entry of reader.streamLogEntries(mockParser)) {
        entries.push(entry);
      }
      
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({ path: '/test', status: 200 });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse line'));
      
      consoleSpy.mockRestore();
    });

    it('should throw error when no log files found', async () => {
      const reader = new LogFileReader('/nonexistent/access.log');
      
      jest.spyOn(reader, 'discoverLogFiles').mockResolvedValue([]);
      
      const mockParser = jest.fn();
      
      await expect(async () => {
        for await (const entry of reader.streamLogEntries(mockParser)) {
          // Should not reach here
        }
      }).rejects.toThrow('No log files found for path');
    });
  });

  describe('streamBatches', () => {
    it('should yield entries in batches', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      // Mock streamLogEntries to yield 5 entries
      const mockEntries = [
        { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }
      ];
      
      jest.spyOn(reader, 'streamLogEntries').mockImplementation(async function* () {
        for (const entry of mockEntries) {
          yield entry;
        }
      });
      
      const mockParser = jest.fn();
      const batches = [];
      
      for await (const batch of reader.streamBatches(mockParser, 2)) {
        batches.push(batch);
      }
      
      expect(batches).toHaveLength(3);
      expect(batches[0]).toEqual([{ id: 1 }, { id: 2 }]);
      expect(batches[1]).toEqual([{ id: 3 }, { id: 4 }]);
      expect(batches[2]).toEqual([{ id: 5 }]); // Remaining entry
    });
  });

  describe('collectAllEntries', () => {
    it('should collect all entries into array', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      const mockEntries = [{ id: 1 }, { id: 2 }, { id: 3 }];
      
      jest.spyOn(reader, 'streamLogEntries').mockImplementation(async function* () {
        for (const entry of mockEntries) {
          yield entry;
        }
      });
      
      const mockParser = jest.fn();
      const entries = await reader.collectAllEntries(mockParser);
      
      expect(entries).toEqual(mockEntries);
    });
  });

  describe('position tracking', () => {
    it('should track current position', () => {
      const reader = new LogFileReader('/var/log/nginx/access.log', { lastPosition: 1024 });
      
      expect(reader.getCurrentPosition()).toBe(1024);
    });

    it('should reset position', () => {
      const reader = new LogFileReader('/var/log/nginx/access.log', { lastPosition: 1024 });
      
      reader.resetPosition();
      
      expect(reader.getCurrentPosition()).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should provide processing statistics', () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      // Simulate some processing
      reader.processedLines = 1000;
      reader.startTime = Date.now() - 5000; // 5 seconds ago
      
      const stats = reader.getStats();
      
      expect(stats.processedLines).toBe(1000);
      expect(stats.elapsedMs).toBeGreaterThan(4000);
      expect(stats.linesPerSecond).toBeGreaterThan(0);
      expect(stats.currentPosition).toBe(0);
      expect(typeof stats.memoryUsageMB).toBe('number');
    });
  });

  describe('memory management', () => {
    it('should check memory usage', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log', { maxMemoryMB: 1 });
      
      // Mock memory usage to exceed limit
      jest.spyOn(reader, 'getMemoryUsageMB').mockReturnValue(2);
      
      await expect(reader.checkMemoryUsage()).rejects.toThrow('Memory usage exceeded limit');
    });

    it('limits what reading adds, not what the process already holds', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log', { maxMemoryMB: 100 });
      const MB = 1024 * 1024;
      const usage = jest.spyOn(process, 'memoryUsage');
      try {
        // A busy scheduler: 400 MB in use before reading starts
        reader.baselineHeapBytes = 400 * MB;
        usage.mockReturnValue({ heapUsed: 450 * MB });
        expect(reader.getMemoryUsageMB()).toBe(50);
        await expect(reader.checkMemoryUsage()).resolves.toBeUndefined();

        usage.mockReturnValue({ heapUsed: 520 * MB });
        await expect(reader.checkMemoryUsage()).rejects.toThrow('grew the heap by 120MB');

        // After a garbage collection the heap can be smaller than at the start
        usage.mockReturnValue({ heapUsed: 300 * MB });
        expect(reader.getMemoryUsageMB()).toBe(0);
      } finally {
        usage.mockRestore();
      }
    });
  });

  describe('utility functions', () => {
    it('should create log file reader', () => {
      const reader = createLogFileReader('/var/log/nginx/access.log', { maxMemoryMB: 128 });
      
      expect(reader).toBeInstanceOf(LogFileReader);
      expect(reader.logPath).toBe('/var/log/nginx/access.log');
      expect(reader.maxMemoryMB).toBe(128);
    });

    it('should discover log files using utility function', async () => {
      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ size: 1024 });
      
      const files = await discoverLogFiles('/var/log/nginx/access.log', ['.1', '.gz']);
      
      expect(Array.isArray(files)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle file access errors', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      jest.spyOn(reader, 'discoverLogFiles').mockRejectedValue(new Error('Access denied'));
      
      const mockParser = jest.fn();
      
      await expect(async () => {
        for await (const entry of reader.streamLogEntries(mockParser)) {
          // Should not reach here
        }
      }).rejects.toThrow('Access denied');
    });

    it('should handle stream errors', async () => {
      const reader = new LogFileReader('/var/log/nginx/access.log');
      
      jest.spyOn(reader, 'discoverLogFiles').mockResolvedValue([
        {
          path: '/var/log/nginx/access.log',
          isCompressed: false,
          rotationIndex: 0,
          size: 1024
        }
      ]);
      
      // Mock readline interface to throw error
      mockReadlineInterface[Symbol.asyncIterator] = async function* () {
        throw new Error('Stream error');
      };
      
      const mockParser = jest.fn();
      
      await expect(async () => {
        for await (const entry of reader.streamLogEntries(mockParser)) {
          // Should not reach here
        }
      }).rejects.toThrow('Failed to stream file');
    });
  });
});