import {
  buildCloudflareImageUrl,
  CLOUDFLARE_IMAGES_DEFAULT_ROOT_URL,
  getCloudflareImagesRootUrl,
  isValidCloudflareImageUrl,
} from './image.constants';

describe('Image Constants', () => {
  const originalEnv = {
    CLOUDFLARE_CDN_ROOT_URL: process.env.CLOUDFLARE_CDN_ROOT_URL,
    CLOUDFLARE_IMAGES_HASH: process.env.CLOUDFLARE_IMAGES_HASH,
  };

  afterEach(() => {
    process.env.CLOUDFLARE_CDN_ROOT_URL = originalEnv.CLOUDFLARE_CDN_ROOT_URL;
    process.env.CLOUDFLARE_IMAGES_HASH = originalEnv.CLOUDFLARE_IMAGES_HASH;
  });

  describe('getCloudflareImagesRootUrl', () => {
    it('builds root URL from CDN root and images hash', () => {
      process.env.CLOUDFLARE_CDN_ROOT_URL = 'https://cdn.startrekonline.info';
      process.env.CLOUDFLARE_IMAGES_HASH = 'jQ0uSdJ3ty-KasNpXGxyuA';

      expect(getCloudflareImagesRootUrl()).toBe(
        'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA',
      );
    });

    it('falls back to default Cloudflare Images host when CDN root is missing', () => {
      delete process.env.CLOUDFLARE_CDN_ROOT_URL;
      process.env.CLOUDFLARE_IMAGES_HASH = 'jQ0uSdJ3ty-KasNpXGxyuA';

      expect(getCloudflareImagesRootUrl()).toBe(
        `${CLOUDFLARE_IMAGES_DEFAULT_ROOT_URL}/jQ0uSdJ3ty-KasNpXGxyuA`,
      );
    });
  });

  describe('buildCloudflareImageUrl', () => {
    beforeEach(() => {
      process.env.CLOUDFLARE_CDN_ROOT_URL = 'https://cdn.startrekonline.info';
      process.env.CLOUDFLARE_IMAGES_HASH = 'jQ0uSdJ3ty-KasNpXGxyuA';
    });

    it('builds full image URL from UUID and variant', () => {
      expect(
        buildCloudflareImageUrl(
          '8ab52131-6f11-408a-d9df-3c1acaa46d00',
          'public',
        ),
      ).toBe(
        'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/8ab52131-6f11-408a-d9df-3c1acaa46d00/public',
      );
    });

    it('throws for empty image UUID', () => {
      expect(() => buildCloudflareImageUrl('', 'public')).toThrow(
        'Cloudflare image UUID is required',
      );
    });

    it('throws for empty variant name', () => {
      expect(() =>
        buildCloudflareImageUrl('8ab52131-6f11-408a-d9df-3c1acaa46d00', ''),
      ).toThrow('Cloudflare image variant is required');
    });
  });

  describe('isValidCloudflareImageUrl', () => {
    beforeEach(() => {
      process.env.CLOUDFLARE_CDN_ROOT_URL = 'https://cdn.startrekonline.info';
      process.env.CLOUDFLARE_IMAGES_HASH = 'jQ0uSdJ3ty-KasNpXGxyuA';
    });

    it('returns true for custom-domain Cloudflare Images URLs', () => {
      expect(
        isValidCloudflareImageUrl(
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/8ab52131-6f11-408a-d9df-3c1acaa46d00/public',
        ),
      ).toBe(true);
    });

    it('returns true for imagedelivery.net URLs', () => {
      expect(
        isValidCloudflareImageUrl(
          'https://imagedelivery.net/jQ0uSdJ3ty-KasNpXGxyuA/8ab52131-6f11-408a-d9df-3c1acaa46d00/public',
        ),
      ).toBe(true);
    });

    it('returns false for non-https URLs', () => {
      expect(
        isValidCloudflareImageUrl(
          'http://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/8ab52131-6f11-408a-d9df-3c1acaa46d00/public',
        ),
      ).toBe(false);
    });

    it('returns false for hash mismatches', () => {
      expect(
        isValidCloudflareImageUrl(
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/wrong-hash/8ab52131-6f11-408a-d9df-3c1acaa46d00/public',
        ),
      ).toBe(false);
    });

    it('returns false for unsupported hosts', () => {
      expect(
        isValidCloudflareImageUrl(
          'https://example.com/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/8ab52131-6f11-408a-d9df-3c1acaa46d00/public',
        ),
      ).toBe(false);
    });
  });
});
