/**
 * @fileoverview Tests for visitor hashing utilities
 */

const { VisitorHasher, generateVisitorHash, generateShortVisitorHash, defaultHasher } = require('./visitor-hash');

describe('VisitorHasher', () => {
  describe('constructor', () => {
    it('should create hasher with custom salt', () => {
      const customSalt = 'custom-test-salt';
      const hasher = new VisitorHasher(customSalt);
      
      expect(hasher.getSalt()).toBe(customSalt);
    });

    it('should create hasher with default salt when none provided', () => {
      const hasher = new VisitorHasher();
      
      expect(hasher.getSalt()).toBeDefined();
      expect(hasher.getSalt().length).toBeGreaterThan(0);
    });

    it('should use environment variable salt when available', () => {
      const originalSalt = process.env.VISITOR_HASH_SALT;
      process.env.VISITOR_HASH_SALT = 'env-test-salt';
      
      const hasher = new VisitorHasher();
      
      expect(hasher.getSalt()).toBe('env-test-salt');
      
      // Restore original environment
      if (originalSalt) {
        process.env.VISITOR_HASH_SALT = originalSalt;
      } else {
        delete process.env.VISITOR_HASH_SALT;
      }
    });
  });

  describe('generateHash', () => {
    const hasher = new VisitorHasher('test-salt');

    it('should generate consistent hash for same inputs', () => {
      const ip = '192.168.1.1';
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      
      const hash1 = hasher.generateHash(ip, userAgent);
      const hash2 = hasher.generateHash(ip, userAgent);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex string
    });

    it('should generate different hashes for different IPs', () => {
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      
      const hash1 = hasher.generateHash('192.168.1.1', userAgent);
      const hash2 = hasher.generateHash('192.168.1.2', userAgent);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hashes for different user agents', () => {
      const ip = '192.168.1.1';
      
      const hash1 = hasher.generateHash(ip, 'Mozilla/5.0 Chrome');
      const hash2 = hasher.generateHash(ip, 'Mozilla/5.0 Firefox');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hashes with different salts', () => {
      const ip = '192.168.1.1';
      const userAgent = 'Mozilla/5.0';
      
      const hasher1 = new VisitorHasher('salt1');
      const hasher2 = new VisitorHasher('salt2');
      
      const hash1 = hasher1.generateHash(ip, userAgent);
      const hash2 = hasher2.generateHash(ip, userAgent);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should throw error for missing IP', () => {
      expect(() => {
        hasher.generateHash('', 'Mozilla/5.0');
      }).toThrow('IP address and user agent are required');
    });

    it('should throw error for missing user agent', () => {
      expect(() => {
        hasher.generateHash('192.168.1.1', '');
      }).toThrow('IP address and user agent are required');
    });
  });

  describe('normalizeIp', () => {
    const hasher = new VisitorHasher('test-salt');

    it('should normalize IPv4 addresses', () => {
      // Access private method for testing
      const normalize = hasher.normalizeIp.bind(hasher);
      
      expect(normalize('192.168.001.001')).toBe('192.168.1.1');
      expect(normalize('  192.168.1.1  ')).toBe('192.168.1.1');
    });

    it('should normalize IPv6 addresses to lowercase', () => {
      const normalize = hasher.normalizeIp.bind(hasher);
      
      expect(normalize('2001:0DB8:85A3:0000:0000:8A2E:0370:7334'))
        .toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    });

    it('should handle edge cases', () => {
      const normalize = hasher.normalizeIp.bind(hasher);
      
      expect(normalize('127.0.0.1')).toBe('127.0.0.1');
      expect(normalize('::1')).toBe('::1');
    });
  });

  describe('normalizeUserAgent', () => {
    const hasher = new VisitorHasher('test-salt');

    it('should normalize whitespace in user agent', () => {
      const normalize = hasher.normalizeUserAgent.bind(hasher);
      
      expect(normalize('Mozilla/5.0    (Windows NT 10.0)'))
        .toBe('Mozilla/5.0 (Windows NT 10.0)');
      expect(normalize('  Mozilla/5.0  '))
        .toBe('Mozilla/5.0');
    });
  });

  describe('generateShortHash', () => {
    const hasher = new VisitorHasher('test-salt');

    it('should generate 8-character hash', () => {
      const shortHash = hasher.generateShortHash('192.168.1.1', 'Mozilla/5.0');
      
      expect(shortHash).toMatch(/^[a-f0-9]{8}$/);
      expect(shortHash.length).toBe(8);
    });

    it('should be consistent', () => {
      const hash1 = hasher.generateShortHash('192.168.1.1', 'Mozilla/5.0');
      const hash2 = hasher.generateShortHash('192.168.1.1', 'Mozilla/5.0');
      
      expect(hash1).toBe(hash2);
    });
  });

  describe('validateHash', () => {
    const hasher = new VisitorHasher('test-salt');

    it('should validate correct hash', () => {
      const ip = '192.168.1.1';
      const userAgent = 'Mozilla/5.0';
      const hash = hasher.generateHash(ip, userAgent);
      
      expect(hasher.validateHash(hash, ip, userAgent)).toBe(true);
    });

    it('should reject incorrect hash', () => {
      const ip = '192.168.1.1';
      const userAgent = 'Mozilla/5.0';
      const wrongHash = 'incorrect-hash';
      
      expect(hasher.validateHash(wrongHash, ip, userAgent)).toBe(false);
    });

    it('should handle validation errors gracefully', () => {
      expect(hasher.validateHash('hash', '', 'Mozilla/5.0')).toBe(false);
    });
  });

  describe('withSalt', () => {
    it('should create new hasher with different salt', () => {
      const originalHasher = new VisitorHasher('original-salt');
      const newHasher = originalHasher.withSalt('new-salt');
      
      expect(originalHasher.getSalt()).toBe('original-salt');
      expect(newHasher.getSalt()).toBe('new-salt');
      
      // Should generate different hashes
      const ip = '192.168.1.1';
      const userAgent = 'Mozilla/5.0';
      const hash1 = originalHasher.generateHash(ip, userAgent);
      const hash2 = newHasher.generateHash(ip, userAgent);
      
      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('Convenience functions', () => {
  describe('generateVisitorHash', () => {
    it('should generate hash using default hasher', () => {
      const hash = generateVisitorHash('192.168.1.1', 'Mozilla/5.0');
      
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should be consistent', () => {
      const hash1 = generateVisitorHash('192.168.1.1', 'Mozilla/5.0');
      const hash2 = generateVisitorHash('192.168.1.1', 'Mozilla/5.0');
      
      expect(hash1).toBe(hash2);
    });
  });

  describe('generateShortVisitorHash', () => {
    it('should generate short hash using default hasher', () => {
      const hash = generateShortVisitorHash('192.168.1.1', 'Mozilla/5.0');
      
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    });
  });

  describe('defaultHasher', () => {
    it('should be a VisitorHasher instance', () => {
      expect(defaultHasher).toBeInstanceOf(VisitorHasher);
    });

    it('should have a salt', () => {
      expect(defaultHasher.getSalt()).toBeDefined();
      expect(defaultHasher.getSalt().length).toBeGreaterThan(0);
    });
  });
});