/**
 * @fileoverview Property-based tests for content ranking algorithms
 * Feature: metrona-analytics-system, Property 4: Content Ranking Correctness
 * **Validates: Requirements 1.4**
 */

const fc = require('fast-check');
const { ContentRanker, rankPages, rankReferrers } = require('./content-ranking');

describe('ContentRanker Property Tests', () => {
  describe('Property 4: Content Ranking Correctness', () => {
    /**
     * Property: For any set of pages with different traffic volumes, the ranking algorithm 
     * should order pages with higher pageview counts before those with lower counts.
     * **Validates: Requirements 1.4**
     */
    it('should order pages by pageview count in descending order', () => {
      // Generator for log entries with controlled pageview counts
      const logEntryGenerator = fc.record({
        timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-31') }),
        ip: fc.tuple(
          fc.integer({ min: 1, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 })
        ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
        method: fc.constantFrom('GET', 'HEAD'),
        path: fc.constantFrom('/page-a', '/page-b', '/page-c', '/page-d', '/page-e'),
        status: fc.constantFrom(200, 301, 302),
        bytes: fc.integer({ min: 100, max: 10000 }),
        referrer: fc.constantFrom('https://google.com', 'https://facebook.com', '-'),
        userAgent: fc.string({ minLength: 10, maxLength: 50 }).filter(s => s.trim().length > 0)
      });

      const entriesGenerator = fc.array(logEntryGenerator, { minLength: 5, maxLength: 100 });
      const ranker = new ContentRanker();

      fc.assert(
        fc.property(entriesGenerator, (entries) => {
          const ranked = ranker.rankPages(entries);
          
          // Property: Pages should be ordered by pageview count in descending order
          for (let i = 1; i < ranked.length; i++) {
            const current = ranked[i];
            const previous = ranked[i - 1];
            expect(current.pageviews).toBeLessThanOrEqual(previous.pageviews);
          }
          
          // Property: All pageview counts should be positive
          ranked.forEach(page => {
            expect(page.pageviews).toBeGreaterThan(0);
          });
          
          // Property: Unique visitors should never exceed pageviews
          ranked.forEach(page => {
            expect(page.uniqueVisitors).toBeLessThanOrEqual(page.pageviews);
          });
          
          // Property: Percentages should sum to approximately 100% (allowing for rounding)
          const totalPercentage = ranked.reduce((sum, page) => sum + page.percentage, 0);
          expect(totalPercentage).toBeGreaterThanOrEqual(99);
          expect(totalPercentage).toBeLessThanOrEqual(101);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Ranking should be stable for entries with equal pageview counts
     */
    it('should maintain stable ordering for equal pageview counts', () => {
      // Generator for entries that will result in equal pageview counts
      const equalPageviewsGenerator = fc.tuple(
        fc.constantFrom('/page-1', '/page-2', '/page-3'),
        fc.integer({ min: 1, max: 5 }) // Number of pageviews per page
      ).chain(([path, count]) => 
        fc.array(
          fc.record({
            timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
            ip: fc.tuple(
              fc.integer({ min: 1, max: 255 }),
              fc.integer({ min: 0, max: 255 }),
              fc.integer({ min: 0, max: 255 }),
              fc.integer({ min: 0, max: 255 })
            ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
            method: fc.constant('GET'),
            path: fc.constant(path),
            status: fc.constant(200),
            bytes: fc.integer({ min: 100, max: 1000 }),
            referrer: fc.constant('-'),
            userAgent: fc.constant('Mozilla/5.0 Test')
          }),
          { minLength: count, maxLength: count }
        )
      );

      const entriesGenerator = fc.array(equalPageviewsGenerator, { minLength: 2, maxLength: 4 })
        .map(arrays => arrays.flat());

      const ranker = new ContentRanker();

      fc.assert(
        fc.property(entriesGenerator, (entries) => {
          const ranked1 = ranker.rankPages(entries);
          const ranked2 = ranker.rankPages(entries);
          
          // Property: Multiple runs should produce the same ordering
          expect(ranked1.map(p => p.path)).toEqual(ranked2.map(p => p.path));
          
          // Property: Pages with equal pageviews should maintain consistent relative order
          for (let i = 1; i < ranked1.length; i++) {
            if (ranked1[i].pageviews === ranked1[i - 1].pageviews) {
              // For equal pageviews, order should be consistent (lexicographic by path)
              expect(ranked1[i].path >= ranked1[i - 1].path).toBe(true);
            }
          }
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Referrer ranking should order by pageview count correctly
     */
    it('should order referrers by pageview count in descending order', () => {
      const referrerEntryGenerator = fc.record({
        timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-31') }),
        ip: fc.tuple(
          fc.integer({ min: 1, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 })
        ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
        method: fc.constant('GET'),
        path: fc.constantFrom('/page1', '/page2', '/page3'),
        status: fc.constant(200),
        bytes: fc.integer({ min: 100, max: 5000 }),
        referrer: fc.constantFrom(
          'https://google.com/search',
          'https://facebook.com/page',
          'https://twitter.com/user',
          'https://reddit.com/r/test',
          'https://news.ycombinator.com'
        ),
        userAgent: fc.string({ minLength: 10, maxLength: 50 }).filter(s => s.trim().length > 0)
      });

      const entriesGenerator = fc.array(referrerEntryGenerator, { minLength: 5, maxLength: 50 });
      const ranker = new ContentRanker();

      fc.assert(
        fc.property(entriesGenerator, (entries) => {
          const ranked = ranker.rankReferrers(entries);
          
          // Property: Referrers should be ordered by pageview count in descending order
          for (let i = 1; i < ranked.length; i++) {
            const current = ranked[i];
            const previous = ranked[i - 1];
            expect(current.pageviews).toBeLessThanOrEqual(previous.pageviews);
          }
          
          // Property: All pageview counts should be positive
          ranked.forEach(referrer => {
            expect(referrer.pageviews).toBeGreaterThan(0);
          });
          
          // Property: Unique visitors should never exceed pageviews
          ranked.forEach(referrer => {
            expect(referrer.uniqueVisitors).toBeLessThanOrEqual(referrer.pageviews);
          });
          
          // Property: Sample paths should be valid and non-empty
          ranked.forEach(referrer => {
            expect(referrer.samplePaths).toBeInstanceOf(Array);
            expect(referrer.samplePaths.length).toBeGreaterThan(0);
            referrer.samplePaths.forEach(path => {
              expect(typeof path).toBe('string');
              expect(path.length).toBeGreaterThan(0);
            });
          });
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Filtering should consistently exclude static assets and admin paths
     */
    it('should consistently filter out static assets and admin paths', () => {
      const mixedEntryGenerator = fc.oneof(
        // Valid pageview entries
        fc.record({
          timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
          ip: fc.constant('192.168.1.1'),
          method: fc.constant('GET'),
          path: fc.constantFrom('/home', '/about', '/blog/post-1', '/products'),
          status: fc.constant(200),
          bytes: fc.integer({ min: 100, max: 5000 }),
          referrer: fc.constant('-'),
          userAgent: fc.constant('Mozilla/5.0 Test')
        }),
        // Static asset entries (should be filtered)
        fc.record({
          timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
          ip: fc.constant('192.168.1.2'),
          method: fc.constant('GET'),
          path: fc.constantFrom('/style.css', '/script.js', '/image.png', '/favicon.ico'),
          status: fc.constant(200),
          bytes: fc.integer({ min: 100, max: 5000 }),
          referrer: fc.constant('-'),
          userAgent: fc.constant('Mozilla/5.0 Test')
        }),
        // Admin path entries (should be filtered)
        fc.record({
          timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
          ip: fc.constant('192.168.1.3'),
          method: fc.constant('GET'),
          path: fc.constantFrom('/admin/users', '/wp-admin/dashboard', '/api/endpoint'),
          status: fc.constant(200),
          bytes: fc.integer({ min: 100, max: 5000 }),
          referrer: fc.constant('-'),
          userAgent: fc.constant('Mozilla/5.0 Test')
        })
      );

      const entriesGenerator = fc.array(mixedEntryGenerator, { minLength: 10, maxLength: 50 });
      const ranker = new ContentRanker();

      fc.assert(
        fc.property(entriesGenerator, (entries) => {
          const ranked = ranker.rankPages(entries);
          
          // Property: No static assets should appear in rankings
          const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico'];
          ranked.forEach(page => {
            const hasStaticExtension = staticExtensions.some(ext => 
              page.path.toLowerCase().endsWith(ext)
            );
            expect(hasStaticExtension).toBe(false);
          });
          
          // Property: No admin paths should appear in rankings
          const adminPatterns = ['/admin', '/wp-admin', '/api'];
          ranked.forEach(page => {
            const isAdminPath = adminPatterns.some(pattern => 
              page.path.toLowerCase().startsWith(pattern)
            );
            expect(isAdminPath).toBe(false);
          });
          
          // Property: All ranked pages should be valid content pages
          ranked.forEach(page => {
            expect(page.path).toMatch(/^\/[a-zA-Z0-9\-_\/]*$/);
            expect(page.pageviews).toBeGreaterThan(0);
          });
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Ranking metrics should be mathematically consistent
     */
    it('should maintain mathematical consistency in ranking metrics', () => {
      const entryGenerator = fc.record({
        timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-31') }),
        ip: fc.tuple(
          fc.integer({ min: 1, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 })
        ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
        method: fc.constant('GET'),
        path: fc.constantFrom('/page-a', '/page-b', '/page-c'),
        status: fc.constant(200),
        bytes: fc.integer({ min: 100, max: 10000 }),
        referrer: fc.constant('-'),
        userAgent: fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0)
      });

      const entriesGenerator = fc.array(entryGenerator, { minLength: 5, maxLength: 30 });
      const ranker = new ContentRanker();

      fc.assert(
        fc.property(entriesGenerator, (entries) => {
          const ranked = ranker.rankPages(entries);
          
          // Property: Average bytes per view should be calculated correctly
          ranked.forEach(page => {
            if (page.pageviews > 0) {
              const expectedAvg = Math.round(page.bytes / page.pageviews);
              expect(page.avgBytesPerView).toBe(expectedAvg);
            } else {
              expect(page.avgBytesPerView).toBe(0);
            }
          });
          
          // Property: Timestamps should be valid ISO strings
          ranked.forEach(page => {
            expect(() => new Date(page.firstSeen)).not.toThrow();
            expect(() => new Date(page.lastSeen)).not.toThrow();
            expect(new Date(page.firstSeen).getTime()).toBeLessThanOrEqual(new Date(page.lastSeen).getTime());
          });
          
          // Property: Percentages should be non-negative and not exceed 100%
          ranked.forEach(page => {
            expect(page.percentage).toBeGreaterThanOrEqual(0);
            expect(page.percentage).toBeLessThanOrEqual(100);
          });
          
          // Property: Total bytes should equal sum of individual page bytes
          const totalBytes = ranked.reduce((sum, page) => sum + page.bytes, 0);
          const validEntries = entries.filter(entry => 
            ranker.isPageview(entry) && ranker.shouldIncludePath(entry.path)
          );
          const expectedTotalBytes = validEntries.reduce((sum, entry) => sum + (entry.bytes || 0), 0);
          expect(totalBytes).toBe(expectedTotalBytes);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Domain extraction should be consistent and valid
     */
    it('should extract domains consistently from referrer URLs', () => {
      const referrerGenerator = fc.oneof(
        // Full URLs with protocol
        fc.record({
          protocol: fc.constantFrom('http://', 'https://'),
          domain: fc.domain(),
          path: fc.string({ minLength: 0, maxLength: 20 }).map(s => '/' + s.replace(/[^a-zA-Z0-9\-_]/g, ''))
        }).map(({ protocol, domain, path }) => `${protocol}${domain}${path}`),
        
        // URLs without protocol
        fc.record({
          domain: fc.domain(),
          path: fc.string({ minLength: 0, maxLength: 20 }).map(s => '/' + s.replace(/[^a-zA-Z0-9\-_]/g, ''))
        }).map(({ domain, path }) => `${domain}${path}`),
        
        // Simple domain names
        fc.domain()
      );

      const entryGenerator = fc.record({
        timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
        ip: fc.constant('192.168.1.1'),
        method: fc.constant('GET'),
        path: fc.constant('/test'),
        status: fc.constant(200),
        bytes: fc.constant(1000),
        referrer: referrerGenerator,
        userAgent: fc.constant('Mozilla/5.0 Test')
      });

      const entriesGenerator = fc.array(entryGenerator, { minLength: 5, maxLength: 20 });
      const ranker = new ContentRanker();

      fc.assert(
        fc.property(entriesGenerator, (entries) => {
          const ranked = ranker.rankReferrers(entries, true); // Group by domain
          
          // Property: All referrer domains should be valid strings
          ranked.forEach(referrer => {
            expect(typeof referrer.referrer).toBe('string');
            expect(referrer.referrer.length).toBeGreaterThan(0);
            
            // Should not contain protocol prefixes
            expect(referrer.referrer).not.toMatch(/^https?:\/\//);
            
            // Should be a valid domain-like string
            expect(referrer.referrer).toMatch(/^[a-zA-Z0-9\-_.]+$/);
          });
          
          // Property: Domain grouping should consolidate URLs from same domain
          const fullUrlRanked = ranker.rankReferrers(entries, false); // Keep full URLs
          expect(ranked.length).toBeLessThanOrEqual(fullUrlRanked.length);
        }),
        { numRuns: 50 }
      );
    });

    /**
     * Property: Custom exclusion patterns should be respected
     */
    it('should respect custom exclusion patterns consistently', () => {
      const entryGenerator = fc.record({
        timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
        ip: fc.constant('192.168.1.1'),
        method: fc.constant('GET'),
        path: fc.constantFrom('/test-page', '/exclude-me', '/normal-page', '/exclude-this-too'),
        status: fc.constant(200),
        bytes: fc.constant(1000),
        referrer: fc.constant('-'),
        userAgent: fc.constant('Mozilla/5.0 Test')
      });

      const entriesGenerator = fc.array(entryGenerator, { minLength: 10, maxLength: 30 });
      
      // Test with string exclusion pattern
      const stringPatternRanker = new ContentRanker({ 
        excludePatterns: ['exclude'],
        filterStaticAssets: false 
      });
      
      // Test with regex exclusion pattern
      const regexPatternRanker = new ContentRanker({ 
        excludePatterns: [/exclude/],
        filterStaticAssets: false 
      });

      fc.assert(
        fc.property(entriesGenerator, (entries) => {
          const stringRanked = stringPatternRanker.rankPages(entries);
          const regexRanked = regexPatternRanker.rankPages(entries);
          
          // Property: String patterns should exclude matching paths
          stringRanked.forEach(page => {
            expect(page.path.toLowerCase()).not.toContain('exclude');
          });
          
          // Property: Regex patterns should exclude matching paths
          regexRanked.forEach(page => {
            expect(page.path).not.toMatch(/exclude/);
          });
          
          // Property: Both approaches should produce same results for this case
          expect(stringRanked.map(p => p.path).sort()).toEqual(regexRanked.map(p => p.path).sort());
          
          // Property: Excluded pages should not appear in results
          const allPaths = stringRanked.map(p => p.path);
          expect(allPaths).not.toContain('/exclude-me');
          expect(allPaths).not.toContain('/exclude-this-too');
          
          // Property: Non-excluded pages should appear if they exist in input
          const inputPaths = entries.map(e => e.path);
          if (inputPaths.includes('/test-page')) {
            expect(allPaths).toContain('/test-page');
          }
          if (inputPaths.includes('/normal-page')) {
            expect(allPaths).toContain('/normal-page');
          }
        }),
        { numRuns: 50 }
      );
    });
  });
});

describe('Convenience Functions Property Tests', () => {
  /**
   * Property: Convenience functions should produce same results as class methods
   */
  it('should produce same results as ContentRanker class methods', () => {
    const entryGenerator = fc.record({
      timestamp: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-01-02') }),
      ip: fc.tuple(
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 })
      ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
      method: fc.constant('GET'),
      path: fc.constantFrom('/page1', '/page2', '/page3'),
      status: fc.constant(200),
      bytes: fc.integer({ min: 100, max: 5000 }),
      referrer: fc.constantFrom('https://google.com', 'https://facebook.com', '-'),
      userAgent: fc.constant('Mozilla/5.0 Test')
    });

    const entriesGenerator = fc.array(entryGenerator, { minLength: 5, maxLength: 20 });

    fc.assert(
      fc.property(entriesGenerator, (entries) => {
        const ranker = new ContentRanker();
        
        // Property: rankPages function should match class method
        const classPages = ranker.rankPages(entries);
        const functionPages = rankPages(entries);
        expect(functionPages).toEqual(classPages);
        
        // Property: rankReferrers function should match class method
        const classReferrers = ranker.rankReferrers(entries);
        const functionReferrers = rankReferrers(entries);
        expect(functionReferrers).toEqual(classReferrers);
      }),
      { numRuns: 50 }
    );
  });
});