/**
 * @fileoverview Property-based tests for LogFileReader log file discovery
 * Feature: metrona-analytics-system, Requirements 1.6
 * Property 6: Log File Discovery Completeness
 */

const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { LogFileReader, discoverLogFiles } = require('./log-file-reader');

describe('LogFileReader Discovery Property Tests', () => {
  let tempDir;

  beforeEach(async () => {
    // Create unique temp directory for each test
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `log-discovery-test-${Date.now()}-`));
  });

  afterEach(async () => {
    // Clean up temporary files with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          console.warn(`Failed to cleanup temp dir ${tempDir}:`, error.message);
        } else {
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  });

  describe('Property 6: Log File Discovery Completeness', () => {
    /**
     * Property: All existing log files should be discovered regardless of rotation pattern
     * 
     * This property validates Requirement 1.6:
     * - Log parser detects and processes rotated log files (.1, .gz extensions)
     */
    it('should discover all existing log files including rotated ones', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Which files to create
            hasMainFile: fc.boolean(),
            hasRotated1: fc.boolean(),
            hasRotated2: fc.boolean(),
            hasRotated3: fc.boolean(),
            hasCompressed: fc.boolean(),
            // File sizes
            mainFileSize: fc.integer({ min: 100, max: 1000 }),
            rotatedFileSize: fc.integer({ min: 50, max: 500 })
          }),
          
          async ({ hasMainFile, hasRotated1, hasRotated2, hasRotated3, hasCompressed, mainFileSize, rotatedFileSize }) => {
            const logPath = path.join(tempDir, `access-${Date.now()}.log`);
            const expectedFiles = [];
            
            // Create main log file if specified
            if (hasMainFile) {
              const content = 'x'.repeat(mainFileSize);
              await fs.promises.writeFile(logPath, content);
              expectedFiles.push({
                path: logPath,
                isCompressed: false,
                rotationIndex: 0,
                shouldExist: true
              });
            }
            
            // Create rotated files if specified
            if (hasRotated1) {
              const rotated1Path = logPath + '.1';
              const content = 'y'.repeat(rotatedFileSize);
              await fs.promises.writeFile(rotated1Path, content);
              expectedFiles.push({
                path: rotated1Path,
                isCompressed: false,
                rotationIndex: 1,
                shouldExist: true
              });
            }
            
            if (hasRotated2) {
              const rotated2Path = logPath + '.2';
              const content = 'z'.repeat(rotatedFileSize);
              await fs.promises.writeFile(rotated2Path, content);
              expectedFiles.push({
                path: rotated2Path,
                isCompressed: false,
                rotationIndex: 2,
                shouldExist: true
              });
            }
            
            if (hasRotated3) {
              const rotated3Path = logPath + '.3';
              const content = 'w'.repeat(rotatedFileSize);
              await fs.promises.writeFile(rotated3Path, content);
              expectedFiles.push({
                path: rotated3Path,
                isCompressed: false,
                rotationIndex: 3,
                shouldExist: true
              });
            }
            
            // Create compressed file if specified
            if (hasCompressed) {
              const compressedPath = logPath + '.gz';
              const content = 'compressed content'.repeat(Math.floor(rotatedFileSize / 20));
              const compressed = zlib.gzipSync(content);
              await fs.promises.writeFile(compressedPath, compressed);
              expectedFiles.push({
                path: compressedPath,
                isCompressed: true,
                rotationIndex: 999, // .gz files get high rotation index
                shouldExist: true
              });
            }
            
            // Discover files using LogFileReader
            const reader = new LogFileReader(logPath);
            const discoveredFiles = await reader.discoverLogFiles();
            
            // CRITICAL: All created files should be discovered
            expect(discoveredFiles.length).toBe(expectedFiles.length);
            
            // Verify each expected file was discovered
            for (const expectedFile of expectedFiles) {
              const found = discoveredFiles.find(f => f.path === expectedFile.path);
              expect(found).toBeDefined();
              expect(found.isCompressed).toBe(expectedFile.isCompressed);
              expect(found.rotationIndex).toBe(expectedFile.rotationIndex);
              expect(found.size).toBeGreaterThan(0);
            }
            
            // Verify files are sorted correctly (oldest first)
            if (discoveredFiles.length > 1) {
              for (let i = 1; i < discoveredFiles.length; i++) {
                expect(discoveredFiles[i].rotationIndex).toBeLessThanOrEqual(discoveredFiles[i - 1].rotationIndex);
              }
            }
            
            // Verify no extra files were discovered
            for (const discoveredFile of discoveredFiles) {
              const expected = expectedFiles.find(f => f.path === discoveredFile.path);
              expect(expected).toBeDefined();
            }
          }
        ),
        { 
          numRuns: 100,
          timeout: 20000
        }
      );
    }, 30000);

    /**
     * Property: Discovery should work with custom rotation extensions
     * 
     * This validates that the discovery mechanism is flexible and can handle
     * different rotation patterns.
     */
    it('should discover files with custom rotation extensions', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Custom extensions to test (ensure uniqueness)
            customExtensions: fc.array(
              fc.oneof(
                fc.constant('.1'),
                fc.constant('.2'),
                fc.constant('.old'),
                fc.constant('.bak'),
                fc.constant('.gz')
              ),
              { minLength: 1, maxLength: 4 }
            ).map(arr => [...new Set(arr)]), // Remove duplicates
            // Which extensions to actually create files for
            createMask: fc.array(fc.boolean(), { minLength: 1, maxLength: 4 })
          }),
          
          async ({ customExtensions, createMask }) => {
            // Ensure createMask matches customExtensions length
            const actualCreateMask = createMask.slice(0, customExtensions.length);
            while (actualCreateMask.length < customExtensions.length) {
              actualCreateMask.push(false);
            }
            
            const logPath = path.join(tempDir, `custom-${Date.now()}.log`);
            const expectedFiles = [];
            
            // Create main file
            await fs.promises.writeFile(logPath, 'main content');
            expectedFiles.push({
              path: logPath,
              isCompressed: false,
              rotationIndex: 0
            });
            
            // Create files with custom extensions
            for (let i = 0; i < customExtensions.length; i++) {
              if (actualCreateMask[i]) {
                const ext = customExtensions[i];
                const filePath = logPath + ext;
                
                if (ext === '.gz') {
                  // Create compressed file
                  const compressed = zlib.gzipSync('compressed content');
                  await fs.promises.writeFile(filePath, compressed);
                  expectedFiles.push({
                    path: filePath,
                    isCompressed: true,
                    rotationIndex: 999
                  });
                } else {
                  // Create regular file
                  await fs.promises.writeFile(filePath, 'rotated content');
                  const rotationIndex = ext === '.1' ? 1 : ext === '.2' ? 2 : i + 1;
                  expectedFiles.push({
                    path: filePath,
                    isCompressed: false,
                    rotationIndex: rotationIndex
                  });
                }
              }
            }
            
            // Use custom extensions for discovery
            const reader = new LogFileReader(logPath, { 
              rotationExtensions: customExtensions 
            });
            const discoveredFiles = await reader.discoverLogFiles();
            
            // CRITICAL: Should discover exactly the files that exist
            expect(discoveredFiles.length).toBe(expectedFiles.length);
            
            // Verify all expected files were found
            for (const expectedFile of expectedFiles) {
              const found = discoveredFiles.find(f => f.path === expectedFile.path);
              expect(found).toBeDefined();
              expect(found.isCompressed).toBe(expectedFile.isCompressed);
            }
          }
        ),
        { 
          numRuns: 50,
          timeout: 15000
        }
      );
    }, 25000);

    /**
     * Property: Discovery should handle missing files gracefully
     * 
     * This validates that discovery works correctly even when some expected
     * files don't exist.
     */
    it('should handle missing files gracefully during discovery', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Which standard files exist
            hasMain: fc.boolean(),
            hasRotated1: fc.boolean(),
            hasRotated2: fc.boolean(),
            hasGzipped: fc.boolean()
          }),
          
          async ({ hasMain, hasRotated1, hasRotated2, hasGzipped }) => {
            const logPath = path.join(tempDir, `test-${Date.now()}.log`);
            let expectedCount = 0;
            
            // Create only the files that should exist
            if (hasMain) {
              await fs.promises.writeFile(logPath, 'main log content');
              expectedCount++;
            }
            
            if (hasRotated1) {
              await fs.promises.writeFile(logPath + '.1', 'rotated content 1');
              expectedCount++;
            }
            
            if (hasRotated2) {
              await fs.promises.writeFile(logPath + '.2', 'rotated content 2');
              expectedCount++;
            }
            
            if (hasGzipped) {
              const compressed = zlib.gzipSync('compressed log content');
              await fs.promises.writeFile(logPath + '.gz', compressed);
              expectedCount++;
            }
            
            // Discover files
            const reader = new LogFileReader(logPath);
            const discoveredFiles = await reader.discoverLogFiles();
            
            // CRITICAL: Should discover exactly the files that exist, no more, no less
            expect(discoveredFiles.length).toBe(expectedCount);
            
            // Verify each discovered file actually exists
            for (const file of discoveredFiles) {
              expect(await fileExists(file.path)).toBe(true);
              expect(file.size).toBeGreaterThan(0);
            }
            
            // Verify correct file types
            const mainFile = discoveredFiles.find(f => f.rotationIndex === 0);
            const rotated1File = discoveredFiles.find(f => f.rotationIndex === 1);
            const rotated2File = discoveredFiles.find(f => f.rotationIndex === 2);
            const gzFile = discoveredFiles.find(f => f.rotationIndex === 999);
            
            if (hasMain) {
              expect(mainFile).toBeDefined();
              expect(mainFile.isCompressed).toBe(false);
            } else {
              expect(mainFile).toBeUndefined();
            }
            
            if (hasRotated1) {
              expect(rotated1File).toBeDefined();
              expect(rotated1File.isCompressed).toBe(false);
            } else {
              expect(rotated1File).toBeUndefined();
            }
            
            if (hasRotated2) {
              expect(rotated2File).toBeDefined();
              expect(rotated2File.isCompressed).toBe(false);
            } else {
              expect(rotated2File).toBeUndefined();
            }
            
            if (hasGzipped) {
              expect(gzFile).toBeDefined();
              expect(gzFile.isCompressed).toBe(true);
            } else {
              expect(gzFile).toBeUndefined();
            }
          }
        ),
        { 
          numRuns: 50,
          timeout: 10000
        }
      );
    }, 20000);

    /**
     * Property: Discovery should work correctly with utility function
     * 
     * This validates that the standalone discovery utility function
     * works the same as the LogFileReader method.
     */
    it('should provide consistent results between reader and utility function', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            filePattern: fc.record({
              hasMain: fc.boolean(),
              hasRotated1: fc.boolean(),
              hasRotated2: fc.boolean(),
              hasGz: fc.boolean()
            })
          }),
          
          async ({ filePattern }) => {
            const logPath = path.join(tempDir, `consistency-${Date.now()}.log`);
            
            // Create files based on pattern
            if (filePattern.hasMain) {
              await fs.promises.writeFile(logPath, 'main content');
            }
            
            if (filePattern.hasRotated1) {
              await fs.promises.writeFile(logPath + '.1', 'rotated 1');
            }
            
            if (filePattern.hasRotated2) {
              await fs.promises.writeFile(logPath + '.2', 'rotated 2');
            }
            
            if (filePattern.hasGz) {
              const compressed = zlib.gzipSync('compressed');
              await fs.promises.writeFile(logPath + '.gz', compressed);
            }
            
            // Discover using LogFileReader method
            const reader = new LogFileReader(logPath);
            const readerResults = await reader.discoverLogFiles();
            
            // Discover using utility function
            const utilityResults = await discoverLogFiles(logPath);
            
            // CRITICAL: Both methods should return identical results
            expect(utilityResults.length).toBe(readerResults.length);
            
            // Sort both arrays by path for comparison
            const sortedReader = readerResults.sort((a, b) => a.path.localeCompare(b.path));
            const sortedUtility = utilityResults.sort((a, b) => a.path.localeCompare(b.path));
            
            for (let i = 0; i < sortedReader.length; i++) {
              expect(sortedUtility[i].path).toBe(sortedReader[i].path);
              expect(sortedUtility[i].isCompressed).toBe(sortedReader[i].isCompressed);
              expect(sortedUtility[i].rotationIndex).toBe(sortedReader[i].rotationIndex);
              expect(sortedUtility[i].size).toBe(sortedReader[i].size);
            }
          }
        ),
        { 
          numRuns: 30,
          timeout: 10000
        }
      );
    }, 20000);

    /**
     * Property: Discovery should handle file size variations correctly
     * 
     * This validates that discovery works with files of different sizes
     * and correctly reports file sizes.
     */
    it('should correctly report file sizes for discovered files', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            mainSize: fc.integer({ min: 0, max: 10000 }),
            rotatedSize: fc.integer({ min: 0, max: 5000 }),
            compressedContentSize: fc.integer({ min: 10, max: 1000 })
          }),
          
          async ({ mainSize, rotatedSize, compressedContentSize }) => {
            const logPath = path.join(tempDir, `sizes-${Date.now()}.log`);
            const expectedSizes = [];
            
            // Create main file with specific size
            const mainContent = 'x'.repeat(mainSize);
            await fs.promises.writeFile(logPath, mainContent);
            expectedSizes.push({
              path: logPath,
              expectedSize: Buffer.byteLength(mainContent, 'utf8')
            });
            
            // Create rotated file with specific size
            const rotatedContent = 'y'.repeat(rotatedSize);
            await fs.promises.writeFile(logPath + '.1', rotatedContent);
            expectedSizes.push({
              path: logPath + '.1',
              expectedSize: Buffer.byteLength(rotatedContent, 'utf8')
            });
            
            // Create compressed file
            const compressedContent = 'z'.repeat(compressedContentSize);
            const compressed = zlib.gzipSync(compressedContent);
            await fs.promises.writeFile(logPath + '.gz', compressed);
            expectedSizes.push({
              path: logPath + '.gz',
              expectedSize: compressed.length
            });
            
            // Discover files
            const reader = new LogFileReader(logPath);
            const discoveredFiles = await reader.discoverLogFiles();
            
            // CRITICAL: Should discover all files with correct sizes
            expect(discoveredFiles.length).toBe(3);
            
            for (const expectedSize of expectedSizes) {
              const found = discoveredFiles.find(f => f.path === expectedSize.path);
              expect(found).toBeDefined();
              expect(found.size).toBe(expectedSize.expectedSize);
            }
          }
        ),
        { 
          numRuns: 30,
          timeout: 10000
        }
      );
    }, 20000);
  });
});

/**
 * Helper function to check if file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} True if file exists
 */
async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}