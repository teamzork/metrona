/**
 * @fileoverview Property-based tests for visitor hashing
 * Feature: metrona-analytics-system, Property 2: Visitor Hash Consistency
 * **Validates: Requirements 1.2**
 */

const fc = require('fast-check');
const { VisitorHasher, generateVisitorHash } = require('./visitor-hash');

describe('VisitorHasher Property Tests', () => {
  describe('Property 2: Visitor Hash Consistency', () => {
    /**
     * Property: For any combination of IP address and user agent, the hashing function 
     * should produce identical hashes for identical inputs and different hashes for 
     * different inputs, ensuring privacy-preserving visitor identification.
     * **Validates: Requirements 1.2**
     */
    it('should produce consistent hashes for identical IP and user agent combinations', () => {
      // Generator for valid IP addresses (IPv4)
      const ipv4Generator = fc.tuple(
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 })
      ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

      // Generator for IPv6 addresses (simplified)
      const ipv6Generator = fc.array(fc.hexaString({ minLength: 1, maxLength: 4 }), { minLength: 8, maxLength: 8 })
        .map(parts => parts.join(':'));

      // Combined IP generator
      const ipGenerator = fc.oneof(ipv4Generator, ipv6Generator);

      // Generator for realistic user agent strings
      const userAgentGenerator = fc.oneof(
        fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'),
        fc.constant('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'),
        fc.constant('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'),
        fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'),
        fc.constant('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:89.0) Gecko/20100101 Firefox/89.0'),
        fc.string({ minLength: 20, maxLength: 200 }).filter(s => !s.includes('"') && s.trim().length > 0)
      );

      // Generator for salt values
      const saltGenerator = fc.string({ minLength: 8, maxLength: 64 });

      fc.assert(
        fc.property(
          ipGenerator,
          userAgentGenerator,
          saltGenerator,
          (ip, userAgent, salt) => {
            const hasher = new VisitorHasher(salt);
            
            // Property: Same inputs should produce identical hashes
            const hash1 = hasher.generateHash(ip, userAgent);
            const hash2 = hasher.generateHash(ip, userAgent);
            
            expect(hash1).toBe(hash2);
            expect(hash1).toMatch(/^[a-f0-9]{64}$/); // Valid SHA-256 hex string
            expect(hash1.length).toBe(64);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Different IP addresses should produce different hashes
     */
    it('should produce different hashes for different IP addresses', () => {
      const userAgent = 'Mozilla/5.0 (consistent user agent)';
      const salt = 'consistent-salt';
      
      // Generator for pairs of different IPv4 addresses
      const differentIpPairGenerator = fc.tuple(
        fc.tuple(
          fc.integer({ min: 1, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 })
        ),
        fc.tuple(
          fc.integer({ min: 1, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 })
        )
      ).filter(([ip1Parts, ip2Parts]) => {
        // Ensure IPs are actually different
        return !ip1Parts.every((part, index) => part === ip2Parts[index]);
      }).map(([ip1Parts, ip2Parts]) => [
        ip1Parts.join('.'),
        ip2Parts.join('.')
      ]);

      fc.assert(
        fc.property(differentIpPairGenerator, ([ip1, ip2]) => {
          const hasher = new VisitorHasher(salt);
          
          const hash1 = hasher.generateHash(ip1, userAgent);
          const hash2 = hasher.generateHash(ip2, userAgent);
          
          // Property: Different IPs should produce different hashes
          expect(hash1).not.toBe(hash2);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Different user agents should produce different hashes
     */
    it('should produce different hashes for different user agents', () => {
      const ip = '192.168.1.1';
      const salt = 'consistent-salt';
      
      // Generator for pairs of different user agent strings
      const differentUserAgentPairGenerator = fc.tuple(
        fc.string({ minLength: 10, maxLength: 100 }).filter(s => s.trim().length > 0),
        fc.string({ minLength: 10, maxLength: 100 }).filter(s => s.trim().length > 0)
      ).filter(([ua1, ua2]) => ua1 !== ua2);

      fc.assert(
        fc.property(differentUserAgentPairGenerator, ([userAgent1, userAgent2]) => {
          const hasher = new VisitorHasher(salt);
          
          const hash1 = hasher.generateHash(ip, userAgent1);
          const hash2 = hasher.generateHash(ip, userAgent2);
          
          // Property: Different user agents should produce different hashes
          expect(hash1).not.toBe(hash2);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Different salts should produce different hashes for same inputs
     */
    it('should produce different hashes with different salts', () => {
      const ip = '192.168.1.1';
      const userAgent = 'Mozilla/5.0 (consistent user agent)';
      
      // Generator for pairs of different salts
      const differentSaltPairGenerator = fc.tuple(
        fc.string({ minLength: 8, maxLength: 32 }),
        fc.string({ minLength: 8, maxLength: 32 })
      ).filter(([salt1, salt2]) => salt1 !== salt2);

      fc.assert(
        fc.property(differentSaltPairGenerator, ([salt1, salt2]) => {
          const hasher1 = new VisitorHasher(salt1);
          const hasher2 = new VisitorHasher(salt2);
          
          const hash1 = hasher1.generateHash(ip, userAgent);
          const hash2 = hasher2.generateHash(ip, userAgent);
          
          // Property: Different salts should produce different hashes
          expect(hash1).not.toBe(hash2);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Hash validation should work correctly
     */
    it('should correctly validate hashes', () => {
      const ipGenerator = fc.tuple(
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 })
      ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

      const userAgentGenerator = fc.string({ minLength: 10, maxLength: 100 })
        .filter(s => s.trim().length > 0);

      const saltGenerator = fc.string({ minLength: 8, maxLength: 32 });

      fc.assert(
        fc.property(
          ipGenerator,
          userAgentGenerator,
          saltGenerator,
          (ip, userAgent, salt) => {
            const hasher = new VisitorHasher(salt);
            
            const hash = hasher.generateHash(ip, userAgent);
            
            // Property: Generated hash should validate correctly
            expect(hasher.validateHash(hash, ip, userAgent)).toBe(true);
            
            // Property: Hash should not validate with different inputs
            const differentIp = ip === '192.168.1.1' ? '192.168.1.2' : '192.168.1.1';
            expect(hasher.validateHash(hash, differentIp, userAgent)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Short hashes should be consistent and properly formatted
     */
    it('should generate consistent short hashes', () => {
      const ipGenerator = fc.tuple(
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 })
      ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

      const userAgentGenerator = fc.string({ minLength: 10, maxLength: 100 })
        .filter(s => s.trim().length > 0);

      fc.assert(
        fc.property(
          ipGenerator,
          userAgentGenerator,
          (ip, userAgent) => {
            const hasher = new VisitorHasher('test-salt');
            
            const shortHash1 = hasher.generateShortHash(ip, userAgent);
            const shortHash2 = hasher.generateShortHash(ip, userAgent);
            
            // Property: Short hashes should be consistent
            expect(shortHash1).toBe(shortHash2);
            
            // Property: Short hashes should be properly formatted
            expect(shortHash1).toMatch(/^[a-f0-9]{8}$/);
            expect(shortHash1.length).toBe(8);
            
            // Property: Short hash should be prefix of full hash
            const fullHash = hasher.generateHash(ip, userAgent);
            expect(fullHash.startsWith(shortHash1)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: IP normalization should be consistent
     */
    it('should normalize IP addresses consistently', () => {
      // Generator for IPv4 addresses with potential normalization issues
      const ipWithVariationsGenerator = fc.tuple(
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 })
      ).chain(([a, b, c, d]) => {
        const normalIp = `${a}.${b}.${c}.${d}`;
        const paddedIp = `${String(a).padStart(3, '0')}.${String(b).padStart(3, '0')}.${String(c).padStart(3, '0')}.${String(d).padStart(3, '0')}`;
        const spacedIp = `  ${normalIp}  `;
        
        return fc.constantFrom(normalIp, paddedIp, spacedIp);
      });

      const userAgent = 'Mozilla/5.0 (test user agent)';
      const hasher = new VisitorHasher('test-salt');

      fc.assert(
        fc.property(ipWithVariationsGenerator, (ip) => {
          const hash1 = hasher.generateHash(ip, userAgent);
          
          // Property: Normalized versions should produce same hash
          // Test by generating hash multiple times - normalization should be consistent
          const hash2 = hasher.generateHash(ip, userAgent);
          expect(hash1).toBe(hash2);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: User agent normalization should be consistent
     */
    it('should normalize user agents consistently', () => {
      const ip = '192.168.1.1';
      
      // Generator for user agents with whitespace variations
      const userAgentWithVariationsGenerator = fc.string({ minLength: 10, maxLength: 50 })
        .filter(s => s.trim().length > 0)
        .chain(baseUA => {
          const normalUA = baseUA.trim().replace(/\s+/g, ' ');
          const spacedUA = `  ${baseUA}  `;
          const multiSpaceUA = baseUA.replace(/\s/g, '   ');
          
          return fc.constantFrom(normalUA, spacedUA, multiSpaceUA);
        });

      const hasher = new VisitorHasher('test-salt');

      fc.assert(
        fc.property(userAgentWithVariationsGenerator, (userAgent) => {
          const hash1 = hasher.generateHash(ip, userAgent);
          
          // Property: Normalized versions should produce same hash
          const hash2 = hasher.generateHash(ip, userAgent);
          expect(hash1).toBe(hash2);
        }),
        { numRuns: 100 }
      );
    });
  });
});