/**
 * @fileoverview Unit tests for content ranking algorithms
 * Feature: metrona-analytics-system, Requirements 1.4
 */

const { ContentRanker, rankPages, rankReferrers, getTopContent } = require('./content-ranking');

describe('ContentRanker', () => {
  let ranker;
  let sampleEntries;

  beforeEach(() => {
    ranker = new ContentRanker();
    
    // Create sample log entries for testing
    sampleEntries = [
      // Popular page - multiple visits
      {
        timestamp: new Date('2026-01-01T10:00:00Z'),
        ip: '192.168.1.1',
        method: 'GET',
        path: '/popular-page',
        status: 200,
        bytes: 5000,
        referrer: 'https://google.com/search',
        userAgent: 'Mozilla/5.0 Chrome'
      },
      {
        timestamp: new Date('2026-01-01T11:00:00Z'),
        ip: '192.168.1.2',
        method: 'GET',
        path: '/popular-page',
        status: 200,
        bytes: 5200,
        referrer: 'https://facebook.com',
        userAgent: 'Mozilla/5.0 Firefox'
      },
      {
        timestamp: new Date('2026-01-01T12:00:00Z'),
        ip: '192.168.1.1', // Same visitor as first entry
        method: 'GET',
        path: '/popular-page',
        status: 200,
        bytes: 4800,
        referrer: 'https://twitter.com',
        userAgent: 'Mozilla/5.0 Chrome'
      },
      
      // Less popular page
      {
        timestamp: new Date('2026-01-01T13:00:00Z'),
        ip: '192.168.1.3',
        method: 'GET',
        path: '/less-popular',
        status: 200,
        bytes: 3000,
        referrer: 'https://google.com/search',
        userAgent: 'Mozilla/5.0 Safari'
      },
      
      // Static asset (should be filtered out)
      {
        timestamp: new Date('2026-01-01T14:00:00Z'),
        ip: '192.168.1.4',
        method: 'GET',
        path: '/style.css',
        status: 200,
        bytes: 1000,
        referrer: '-',
        userAgent: 'Mozilla/5.0 Chrome'
      },
      
      // Admin path (should be filtered out)
      {
        timestamp: new Date('2026-01-01T15:00:00Z'),
        ip: '192.168.1.5',
        method: 'GET',
        path: '/admin/dashboard',
        status: 200,
        bytes: 2000,
        referrer: '-',
        userAgent: 'Mozilla/5.0 Firefox'
      },
      
      // Non-pageview (POST method)
      {
        timestamp: new Date('2026-01-01T16:00:00Z'),
        ip: '192.168.1.6',
        method: 'POST',
        path: '/api/submit',
        status: 200,
        bytes: 500,
        referrer: '-',
        userAgent: 'Mozilla/5.0 Chrome'
      },
      
      // Error status (should be filtered out)
      {
        timestamp: new Date('2026-01-01T17:00:00Z'),
        ip: '192.168.1.7',
        method: 'GET',
        path: '/not-found',
        status: 404,
        bytes: 1500,
        referrer: 'https://google.com',
        userAgent: 'Mozilla/5.0 Safari'
      }
    ];
  });

  describe('constructor', () => {
    it('should create ranker with default options', () => {
      const defaultRanker = new ContentRanker();
      expect(defaultRanker.maxResults).toBe(20);
      expect(defaultRanker.excludePatterns).toEqual([]);
      expect(defaultRanker.filterStaticAssets).toBe(true);
    });

    it('should create ranker with custom options', () => {
      const customRanker = new ContentRanker({
        maxResults: 10,
        excludePatterns: ['/test'],
        filterStaticAssets: false
      });
      expect(customRanker.maxResults).toBe(10);
      expect(customRanker.excludePatterns).toEqual(['/test']);
      expect(customRanker.filterStaticAssets).toBe(false);
    });
  });

  describe('rankPages', () => {
    it('should rank pages by pageviews in descending order', () => {
      const ranked = ranker.rankPages(sampleEntries);
      
      expect(ranked).toHaveLength(2); // Only 2 valid pages after filtering
      expect(ranked[0].path).toBe('/popular-page');
      expect(ranked[0].pageviews).toBe(3);
      expect(ranked[1].path).toBe('/less-popular');
      expect(ranked[1].pageviews).toBe(1);
    });

    it('should rank pages by unique visitors when specified', () => {
      const ranked = ranker.rankPages(sampleEntries, 'uniqueVisitors');
      
      expect(ranked[0].path).toBe('/popular-page');
      expect(ranked[0].uniqueVisitors).toBe(2); // Two different IPs
      expect(ranked[1].path).toBe('/less-popular');
      expect(ranked[1].uniqueVisitors).toBe(1);
    });

    it('should calculate correct metrics for each page', () => {
      const ranked = ranker.rankPages(sampleEntries);
      const popularPage = ranked[0];
      
      expect(popularPage.path).toBe('/popular-page');
      expect(popularPage.pageviews).toBe(3);
      expect(popularPage.uniqueVisitors).toBe(2);
      expect(popularPage.bytes).toBe(15000); // 5000 + 5200 + 4800
      expect(popularPage.avgBytesPerView).toBe(5000); // 15000 / 3
      expect(popularPage.percentage).toBe(75); // 3 out of 4 total pageviews
      expect(popularPage.firstSeen).toBe('2026-01-01T10:00:00.000Z');
      expect(popularPage.lastSeen).toBe('2026-01-01T12:00:00.000Z');
    });

    it('should filter out static assets by default', () => {
      const ranked = ranker.rankPages(sampleEntries);
      const paths = ranked.map(page => page.path);
      
      expect(paths).not.toContain('/style.css');
    });

    it('should filter out admin paths by default', () => {
      const ranked = ranker.rankPages(sampleEntries);
      const paths = ranked.map(page => page.path);
      
      expect(paths).not.toContain('/admin/dashboard');
    });

    it('should include static assets when filtering is disabled', () => {
      const customRanker = new ContentRanker({ filterStaticAssets: false });
      const ranked = customRanker.rankPages(sampleEntries);
      const paths = ranked.map(page => page.path);
      
      expect(paths).toContain('/style.css');
    });

    it('should respect custom exclude patterns', () => {
      const customRanker = new ContentRanker({ 
        excludePatterns: ['/popular'],
        filterStaticAssets: false 
      });
      const ranked = customRanker.rankPages(sampleEntries);
      const paths = ranked.map(page => page.path);
      
      expect(paths).not.toContain('/popular-page');
      expect(paths).toContain('/less-popular'); // Doesn't match pattern exactly
    });

    it('should respect maxResults limit', () => {
      const customRanker = new ContentRanker({ maxResults: 1 });
      const ranked = customRanker.rankPages(sampleEntries);
      
      expect(ranked).toHaveLength(1);
      expect(ranked[0].path).toBe('/popular-page');
    });

    it('should handle empty entries array', () => {
      const ranked = ranker.rankPages([]);
      expect(ranked).toEqual([]);
    });

    it('should handle null/undefined entries', () => {
      expect(ranker.rankPages(null)).toEqual([]);
      expect(ranker.rankPages(undefined)).toEqual([]);
    });
  });

  describe('rankReferrers', () => {
    it('should rank referrers by pageviews in descending order', () => {
      const ranked = ranker.rankReferrers(sampleEntries);
      
      expect(ranked).toHaveLength(3);
      expect(ranked[0].referrer).toBe('google.com');
      expect(ranked[0].pageviews).toBe(2); // Two entries from Google
      expect(ranked[1].referrer).toBe('facebook.com');
      expect(ranked[1].pageviews).toBe(1);
      expect(ranked[2].referrer).toBe('twitter.com');
      expect(ranked[2].pageviews).toBe(1);
    });

    it('should group by domain by default', () => {
      const ranked = ranker.rankReferrers(sampleEntries);
      const referrers = ranked.map(r => r.referrer);
      
      expect(referrers).toContain('google.com');
      expect(referrers).not.toContain('https://google.com/search');
    });

    it('should keep full URLs when groupByDomain is false', () => {
      const ranked = ranker.rankReferrers(sampleEntries, false);
      const referrers = ranked.map(r => r.referrer);
      
      expect(referrers).toContain('https://google.com/search');
      expect(referrers).toContain('https://facebook.com');
    });

    it('should calculate correct metrics for each referrer', () => {
      const ranked = ranker.rankReferrers(sampleEntries);
      const googleReferrer = ranked[0];
      
      expect(googleReferrer.referrer).toBe('google.com');
      expect(googleReferrer.pageviews).toBe(2);
      expect(googleReferrer.uniqueVisitors).toBe(2); // Two different visitors
      expect(googleReferrer.percentage).toBe(50); // 2 out of 4 total pageviews
      expect(googleReferrer.samplePaths).toContain('/popular-page');
      expect(googleReferrer.samplePaths).toContain('/less-popular');
    });

    it('should filter out internal referrers', () => {
      const entriesWithInternal = [
        ...sampleEntries,
        {
          timestamp: new Date('2026-01-01T18:00:00Z'),
          ip: '192.168.1.8',
          method: 'GET',
          path: '/internal-link',
          status: 200,
          bytes: 2000,
          referrer: 'http://localhost:3000/page',
          userAgent: 'Mozilla/5.0 Chrome'
        }
      ];
      
      const ranked = ranker.rankReferrers(entriesWithInternal);
      const referrers = ranked.map(r => r.referrer);
      
      expect(referrers).not.toContain('localhost');
    });

    it('should filter out empty or dash referrers', () => {
      const ranked = ranker.rankReferrers(sampleEntries);
      const referrers = ranked.map(r => r.referrer);
      
      expect(referrers).not.toContain('-');
      expect(referrers).not.toContain('');
    });

    it('should handle malformed URLs gracefully', () => {
      const entriesWithMalformed = [
        {
          timestamp: new Date('2026-01-01T19:00:00Z'),
          ip: '192.168.1.9',
          method: 'GET',
          path: '/test',
          status: 200,
          bytes: 1000,
          referrer: 'not-a-valid-url',
          userAgent: 'Mozilla/5.0 Chrome'
        }
      ];
      
      const ranked = ranker.rankReferrers(entriesWithMalformed);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].referrer).toBe('not-a-valid-url'); // Falls back to original
    });

    it('should respect maxResults limit', () => {
      const customRanker = new ContentRanker({ maxResults: 2 });
      const ranked = customRanker.rankReferrers(sampleEntries);
      
      expect(ranked).toHaveLength(2);
    });

    it('should handle empty entries array', () => {
      const ranked = ranker.rankReferrers([]);
      expect(ranked).toEqual([]);
    });
  });

  describe('getTopContent', () => {
    it('should return comprehensive top content analysis', () => {
      const topContent = ranker.getTopContent(sampleEntries);
      
      expect(topContent).toHaveProperty('topPages');
      expect(topContent).toHaveProperty('topPagesByVisitors');
      expect(topContent).toHaveProperty('topReferrers');
      expect(topContent).toHaveProperty('topReferrerUrls');
      
      expect(topContent.topPages).toHaveLength(2);
      expect(topContent.topReferrers).toHaveLength(3);
    });

    it('should have consistent data across different views', () => {
      const topContent = ranker.getTopContent(sampleEntries);
      
      // Top page should be the same in both pageview and visitor rankings
      expect(topContent.topPages[0].path).toBe('/popular-page');
      expect(topContent.topPagesByVisitors[0].path).toBe('/popular-page');
      
      // Top referrer should be consistent
      expect(topContent.topReferrers[0].referrer).toBe('google.com');
    });
  });

  describe('helper methods', () => {
    describe('isPageview', () => {
      it('should identify valid pageviews', () => {
        const validEntry = {
          method: 'GET',
          status: 200,
          userAgent: 'Mozilla/5.0 Chrome'
        };
        expect(ranker.isPageview(validEntry)).toBe(true);
      });

      it('should reject non-GET/HEAD methods', () => {
        const postEntry = {
          method: 'POST',
          status: 200,
          userAgent: 'Mozilla/5.0 Chrome'
        };
        expect(ranker.isPageview(postEntry)).toBe(false);
      });

      it('should reject error status codes', () => {
        const errorEntry = {
          method: 'GET',
          status: 404,
          userAgent: 'Mozilla/5.0 Chrome'
        };
        expect(ranker.isPageview(errorEntry)).toBe(false);
      });

      it('should reject empty user agents', () => {
        const emptyUAEntry = {
          method: 'GET',
          status: 200,
          userAgent: ''
        };
        expect(ranker.isPageview(emptyUAEntry)).toBe(false);
      });
    });

    describe('shouldIncludePath', () => {
      it('should include regular paths', () => {
        expect(ranker.shouldIncludePath('/about')).toBe(true);
        expect(ranker.shouldIncludePath('/blog/post-1')).toBe(true);
      });

      it('should include root path', () => {
        expect(ranker.shouldIncludePath('/')).toBe(true);
      });

      it('should exclude static assets', () => {
        expect(ranker.shouldIncludePath('/style.css')).toBe(false);
        expect(ranker.shouldIncludePath('/script.js')).toBe(false);
        expect(ranker.shouldIncludePath('/image.png')).toBe(false);
      });

      it('should exclude admin paths', () => {
        expect(ranker.shouldIncludePath('/admin/users')).toBe(false);
        expect(ranker.shouldIncludePath('/wp-admin/dashboard')).toBe(false);
        expect(ranker.shouldIncludePath('/api/endpoint')).toBe(false);
      });
    });

    describe('extractDomain', () => {
      it('should extract domain from full URLs', () => {
        expect(ranker.extractDomain('https://google.com/search')).toBe('google.com');
        expect(ranker.extractDomain('http://facebook.com/page')).toBe('facebook.com');
      });

      it('should handle URLs without protocol', () => {
        expect(ranker.extractDomain('twitter.com/user')).toBe('twitter.com');
      });

      it('should handle www subdomains', () => {
        expect(ranker.extractDomain('https://www.example.com')).toBe('www.example.com');
      });

      it('should handle malformed URLs', () => {
        expect(ranker.extractDomain('not-a-url')).toBe('not-a-url');
      });

      it('should return null for empty referrers', () => {
        expect(ranker.extractDomain('')).toBe(null);
        expect(ranker.extractDomain('-')).toBe(null);
      });
    });
  });
});

describe('Convenience functions', () => {
  const sampleEntries = [
    {
      timestamp: new Date('2026-01-01T10:00:00Z'),
      ip: '192.168.1.1',
      method: 'GET',
      path: '/test',
      status: 200,
      bytes: 1000,
      referrer: 'https://google.com',
      userAgent: 'Mozilla/5.0 Chrome'
    }
  ];

  describe('rankPages', () => {
    it('should work as convenience function', () => {
      const ranked = rankPages(sampleEntries);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].path).toBe('/test');
    });

    it('should accept custom options', () => {
      const ranked = rankPages(sampleEntries, 'pageviews', { maxResults: 5 });
      expect(ranked).toHaveLength(1);
    });
  });

  describe('rankReferrers', () => {
    it('should work as convenience function', () => {
      const ranked = rankReferrers(sampleEntries);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].referrer).toBe('google.com');
    });

    it('should accept groupByDomain parameter', () => {
      const ranked = rankReferrers(sampleEntries, false);
      expect(ranked[0].referrer).toBe('https://google.com');
    });
  });

  describe('getTopContent', () => {
    it('should work as convenience function', () => {
      const topContent = getTopContent(sampleEntries);
      expect(topContent).toHaveProperty('topPages');
      expect(topContent).toHaveProperty('topReferrers');
    });

    it('should accept custom options', () => {
      const topContent = getTopContent(sampleEntries, { maxResults: 5 });
      expect(topContent.topPages).toHaveLength(1);
    });
  });
});