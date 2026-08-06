import {
  buildAccountBackgroundImageLookup,
  buildPlatformLauncherLookupKey,
  FALLBACK_ACCOUNT_TYPE_IMAGE_ID,
  resolveAccountTypeImageUrl,
} from './account-image.utility';

const EXACT_URL = 'https://imagedelivery.net/hash/exact/public';
const PLATFORM_URL = 'https://imagedelivery.net/hash/platform/public';
const LAUNCHER_URL = 'https://imagedelivery.net/hash/launcher/public';
const GLOBAL_URL = 'https://imagedelivery.net/hash/global/public';

describe('accountImageUtility', () => {
  const originalImagesHash = process.env.CLOUDFLARE_IMAGES_HASH;

  beforeEach(() => {
    delete process.env.CLOUDFLARE_IMAGES_HASH;
  });

  afterEach(() => {
    if (originalImagesHash === undefined) {
      delete process.env.CLOUDFLARE_IMAGES_HASH;
    } else {
      process.env.CLOUDFLARE_IMAGES_HASH = originalImagesHash;
    }
  });

  describe('buildPlatformLauncherLookupKey', () => {
    it('should join the platform and launcher ids with a pipe', () => {
      expect(buildPlatformLauncherLookupKey('p1', 'l1')).toBe('p1|l1');
    });

    it('should treat null ids as empty segments', () => {
      expect(buildPlatformLauncherLookupKey(null, null)).toBe('|');
    });

    it('should treat omitted ids as empty segments', () => {
      expect(buildPlatformLauncherLookupKey()).toBe('|');
    });
  });

  describe('buildAccountBackgroundImageLookup', () => {
    it('should index valid mappings by their lookup key', () => {
      const lookup = buildAccountBackgroundImageLookup([
        { platformId: 'p1', launcherId: 'l1', backgroundImageUrl: EXACT_URL },
      ]);

      expect(lookup.get('p1|l1')).toBe(EXACT_URL);
    });

    it('should skip mappings whose URL is not a Cloudflare image URL', () => {
      const lookup = buildAccountBackgroundImageLookup([
        {
          platformId: 'p1',
          launcherId: 'l1',
          backgroundImageUrl: 'http://evil.example.com/x.png',
        },
      ]);

      expect(lookup.size).toBe(0);
    });

    it('should skip mappings with no URL at all', () => {
      const lookup = buildAccountBackgroundImageLookup([
        { platformId: 'p1', launcherId: 'l1', backgroundImageUrl: null },
      ]);

      expect(lookup.size).toBe(0);
    });

    it('should return an empty lookup for no mappings', () => {
      expect(buildAccountBackgroundImageLookup([]).size).toBe(0);
    });
  });

  describe('resolveAccountTypeImageUrl', () => {
    it('should prefer an exact platform and launcher match', () => {
      const lookup = new Map([
        ['p1|l1', EXACT_URL],
        ['p1|', PLATFORM_URL],
        ['|l1', LAUNCHER_URL],
        ['|', GLOBAL_URL],
      ]);

      expect(
        resolveAccountTypeImageUrl(
          { platformId: 'p1', launcherId: 'l1' },
          lookup,
        ),
      ).toBe(EXACT_URL);
    });

    it('should fall back to the platform default', () => {
      const lookup = new Map([
        ['p1|', PLATFORM_URL],
        ['|l1', LAUNCHER_URL],
        ['|', GLOBAL_URL],
      ]);

      expect(
        resolveAccountTypeImageUrl(
          { platformId: 'p1', launcherId: 'l1' },
          lookup,
        ),
      ).toBe(PLATFORM_URL);
    });

    it('should fall back to the launcher default', () => {
      const lookup = new Map([
        ['|l1', LAUNCHER_URL],
        ['|', GLOBAL_URL],
      ]);

      expect(
        resolveAccountTypeImageUrl(
          { platformId: 'p1', launcherId: 'l1' },
          lookup,
        ),
      ).toBe(LAUNCHER_URL);
    });

    it('should fall back to the global default', () => {
      const lookup = new Map([['|', GLOBAL_URL]]);

      expect(
        resolveAccountTypeImageUrl(
          { platformId: 'p1', launcherId: 'l1' },
          lookup,
        ),
      ).toBe(GLOBAL_URL);
    });

    it('should fall back to the static image when nothing matches', () => {
      const result = resolveAccountTypeImageUrl(
        { platformId: 'p1', launcherId: 'l1' },
        new Map(),
      );

      expect(result).toContain(FALLBACK_ACCOUNT_TYPE_IMAGE_ID);
    });
  });
});
