import { generateSlug, normalizeHandle } from './handle.utility';

describe('handleUtility', () => {
  describe('normalizeHandle', () => {
    it('should lower-case the handle', () => {
      expect(normalizeHandle('SteveX')).toBe('stevex');
    });

    it('should trim surrounding whitespace', () => {
      expect(normalizeHandle('  SteveX  ')).toBe('stevex');
    });

    it('should preserve the # discriminator so stored values stay stable', () => {
      expect(normalizeHandle('SteveX#1234')).toBe('stevex#1234');
    });

    it('should return an empty string for a whitespace-only handle', () => {
      expect(normalizeHandle('   ')).toBe('');
    });
  });

  describe('generateSlug', () => {
    it('should replace the # discriminator with a tilde', () => {
      expect(generateSlug('SteveX#1234')).toBe('SteveX~1234');
    });

    it('should replace every # when more than one is present', () => {
      expect(generateSlug('a#b#c')).toBe('a~b~c');
    });

    it('should preserve casing', () => {
      expect(generateSlug('SteveX')).toBe('SteveX');
    });

    it('should trim surrounding whitespace', () => {
      expect(generateSlug('  SteveX#1234  ')).toBe('SteveX~1234');
    });

    it('should return an empty string for a whitespace-only handle', () => {
      expect(generateSlug('   ')).toBe('');
    });
  });
});
