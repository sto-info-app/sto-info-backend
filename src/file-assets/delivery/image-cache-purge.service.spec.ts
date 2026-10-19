import { Logger } from '@nestjs/common';

import axios from 'axios';

import { DELIVERY_VARIANTS } from 'src/shared/constants/image.constants';
import { SecretsService } from 'src/shared/secrets/secrets.service';

import { ImageCachePurgeService } from './image-cache-purge.service';
import { ImageSigningService } from './image-signing.service';

jest.mock('axios');

/** Signs as the real service would, so each moment gives its own query. */
const signature = (
  _hash: string,
  imageId: string,
  variant: string,
  now: Date,
): string => `exp=${now.toISOString().slice(0, 10)}&sig=${imageId}-${variant}`;

describe('ImageCachePurgeService', () => {
  const env = process.env;
  const now = new Date('2026-10-19T07:00:00Z');

  let service: ImageCachePurgeService;
  let secret: Record<string, unknown> | undefined;
  let signing: { signature: jest.Mock };
  let post: jest.Mock;

  beforeEach(async () => {
    process.env = {
      ...env,
      AWS_SECRET_NAME: 'app-secret',
      CLOUDFLARE_CDN_ROOT_URL: 'https://cdn.example.test',
      CLOUDFLARE_IMAGES_HASH: 'hash-1',
    };
    secret = { cloudflareZoneId: 'zone-1', cloudflareCachePurgeToken: 'tok' };
    signing = { signature: jest.fn(signature) };
    post = jest
      .mocked(axios.post)
      .mockResolvedValue({ data: { success: true } });

    service = new ImageCachePurgeService(
      {
        getSecret: jest.fn(async () => secret),
      } as unknown as SecretsService,
      signing as unknown as ImageSigningService,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await service.onModuleInit();
  });

  afterEach(() => {
    process.env = env;
    jest.restoreAllMocks();
    jest.mocked(axios.post).mockReset();
  });

  describe('addressesOf', () => {
    // An address expires at the end of the day after it was signed, so
    // yesterday's and today's are the two that may still be cached.
    it('lists every variant unsigned, signed for today and signed for yesterday', () => {
      const addresses = service.addressesOf('image-1', now);
      const base =
        'https://cdn.example.test/cdn-cgi/imagedelivery/hash-1/image-1';

      expect(addresses).toHaveLength(DELIVERY_VARIANTS.length * 3);
      expect(addresses).toContain(`${base}/square300`);
      expect(addresses).toContain(
        `${base}/square300?exp=2026-10-19&sig=image-1-square300`,
      );
      expect(addresses).toContain(
        `${base}/square300?exp=2026-10-18&sig=image-1-square300`,
      );
      expect(addresses).toContain(`${base}/portrait400x600`);
    });

    it('lists only the unsigned addresses when nothing is signed', () => {
      signing.signature.mockReturnValue(null);

      expect(service.addressesOf('image-1', now)).toHaveLength(
        DELIVERY_VARIANTS.length,
      );
    });

    it.each(['CLOUDFLARE_CDN_ROOT_URL', 'CLOUDFLARE_IMAGES_HASH'])(
      'lists nothing without %s',
      name => {
        delete process.env[name];

        expect(service.addressesOf('image-1', now)).toEqual([]);
      },
    );

    it('signs at the moment it is asked when no moment is given', () => {
      expect(service.addressesOf('image-1').length).toBeGreaterThan(0);
    });
  });

  describe('purge', () => {
    it('purges every address, thirty to a request', async () => {
      await expect(service.purge('image-1')).resolves.toBe(true);

      const total = DELIVERY_VARIANTS.length * 3;

      expect(post).toHaveBeenCalledTimes(Math.ceil(total / 30));
      expect(post).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache',
        { files: expect.arrayContaining([expect.any(String)]) },
        { headers: { Authorization: 'Bearer tok' } },
      );

      const sent = post.mock.calls.flatMap(
        call => (call[1] as { files: string[] }).files,
      );

      expect(sent).toHaveLength(total);
      expect(
        post.mock.calls.every(
          call => (call[1] as { files: string[] }).files.length <= 30,
        ),
      ).toBe(true);
    });

    // Left owed, so the hourly sweep tries again.
    it('reports a purge Cloudflare refused', async () => {
      post.mockRejectedValueOnce(new Error('429 Too Many Requests'));

      await expect(service.purge('image-1')).resolves.toBe(false);

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        '[purge] Edge cache not purged - ImageId: image-1, Reason: 429 Too Many Requests',
      );
    });

    it('reports a failure that is not an Error', async () => {
      post.mockRejectedValueOnce('refused');

      await expect(service.purge('image-1')).resolves.toBe(false);

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        '[purge] Edge cache not purged - ImageId: image-1, Reason: unknown',
      );
    });
  });

  describe('without the zone or token', () => {
    it.each([
      [{ cloudflareCachePurgeToken: 'tok' }],
      [{ cloudflareZoneId: 'zone-1', cloudflareCachePurgeToken: '  ' }],
      [{ cloudflareZoneId: 3, cloudflareCachePurgeToken: 'tok' }],
      [undefined],
    ])('purges nothing and says so (%p)', async value => {
      secret = value;
      await service.onModuleInit();

      expect(service.enabled).toBe(false);
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('cloudflareCachePurgeToken is not set'),
      );
      await expect(service.purge('image-1')).resolves.toBe(true);
      expect(post).not.toHaveBeenCalled();
    });
  });
});
