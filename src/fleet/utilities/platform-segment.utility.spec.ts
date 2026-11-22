import {
  findPlatformBySegment,
  normalisePlatformSegment,
  toPlatformSegment,
} from './platform-segment.utility';

describe('platform segment utility', () => {
  /** The catalogue as `account-seeder.service` seeds it. */
  const platforms = [
    { id: 'platform-windows', name: 'Windows' },
    { id: 'platform-playstation', name: 'PlayStation' },
    { id: 'platform-xbox', name: 'Xbox' },
  ];

  describe('toPlatformSegment', () => {
    it.each([
      ['Windows', 'windows'],
      ['PlayStation', 'playstation'],
      ['Xbox', 'xbox'],
    ])('turns %s into %s', (name, expected) => {
      expect(toPlatformSegment(name)).toBe(expected);
    });

    /**
     * Nothing in the catalogue has a space in it today. A platform added later
     * might, and a URL segment containing one would have to be escaped every
     * time it was written, which is how a link ends up with a `%20` in it.
     */
    it('hyphenates a name with a space in it', () => {
      expect(toPlatformSegment('Nintendo Switch')).toBe('nintendo-switch');
      expect(toPlatformSegment('Epic  Games  Store')).toBe('epic-games-store');
    });

    it('ignores whitespace around the name', () => {
      expect(toPlatformSegment('  Xbox  ')).toBe('xbox');
    });
  });

  describe('normalisePlatformSegment', () => {
    /**
     * Matching is case-insensitive on the way in so an old capitalised link
     * still resolves, while every link the site writes is lowercase.
     */
    it('reduces a segment the same way a name is reduced', () => {
      expect(normalisePlatformSegment('PlayStation')).toBe('playstation');
      expect(normalisePlatformSegment('XBOX')).toBe('xbox');
    });
  });

  describe('findPlatformBySegment', () => {
    it('finds the platform a segment names', () => {
      expect(findPlatformBySegment('playstation', platforms)).toBe(
        platforms[1],
      );
    });

    it('finds it whatever case the URL carried', () => {
      expect(findPlatformBySegment('PlayStation', platforms)).toBe(
        platforms[1],
      );
    });

    /**
     * The caller turns this into a 404. It must never fall back to a default
     * platform: a URL that quietly serves the wrong platform's Fleet is worse
     * than one that serves nothing.
     */
    it('answers null when the segment names no platform', () => {
      expect(findPlatformBySegment('dreamcast', platforms)).toBeNull();
    });
  });
});
