import { normaliseToSlug, trimTrailingHyphens } from './slug.utility';

describe('slug utility', () => {
  describe('normaliseToSlug', () => {
    it('lowercases and hyphenates a title', () => {
      expect(normaliseToSlug('The Long Way Home')).toBe('the-long-way-home');
    });

    // Folding rather than dropping accents keeps the word readable.
    it('folds accented characters to their base letters', () => {
      expect(normaliseToSlug('Sécurité')).toBe('securite');
    });

    it('collapses runs of punctuation into a single hyphen', () => {
      expect(normaliseToSlug('Warp   Core -- Breach!!')).toBe(
        'warp-core-breach',
      );
    });

    it('removes leading and trailing punctuation', () => {
      expect(normaliseToSlug('...Engage...')).toBe('engage');
    });

    it('keeps digits', () => {
      expect(normaliseToSlug('Stardate 47634.44')).toBe('stardate-47634-44');
    });

    it('returns empty for a title with no alphanumeric characters', () => {
      expect(normaliseToSlug('!!! ???')).toBe('');
    });

    it('returns empty for an empty title', () => {
      expect(normaliseToSlug('')).toBe('');
    });

    it('truncates to the requested length', () => {
      expect(normaliseToSlug('a'.repeat(300), 10)).toHaveLength(10);
    });

    // Slicing can land on a hyphen, which would otherwise be left dangling.
    it('never ends in a hyphen after truncation', () => {
      const result = normaliseToSlug('abcde fghij klmno', 6);

      expect(result).toBe('abcde');
    });

    it('applies the default maximum length', () => {
      expect(normaliseToSlug('a'.repeat(500))).toHaveLength(220);
    });
  });

  describe('trimTrailingHyphens', () => {
    it('removes trailing hyphens', () => {
      expect(trimTrailingHyphens('warp-core---')).toBe('warp-core');
    });

    it('leaves a value without trailing hyphens alone', () => {
      expect(trimTrailingHyphens('warp-core')).toBe('warp-core');
    });

    it('handles a value made only of hyphens', () => {
      expect(trimTrailingHyphens('---')).toBe('');
    });

    it('handles an empty value', () => {
      expect(trimTrailingHyphens('')).toBe('');
    });
  });
});
