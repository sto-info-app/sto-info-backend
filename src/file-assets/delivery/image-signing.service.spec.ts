import { createHmac } from 'crypto';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SecretsService } from 'src/shared/secrets/secrets.service';

import {
  ImageSigningService,
  signedImageExpiry,
} from './image-signing.service';

describe('ImageSigningService (FC-040)', () => {
  let getSecret: jest.Mock<(name: string) => Promise<unknown>>;
  let service: ImageSigningService;

  beforeEach(() => {
    getSecret = jest.fn(() =>
      Promise.resolve({ cloudflareImagesSigningKey: 'test-signing-key' }),
    );
    service = new ImageSigningService({
      getSecret,
    } as unknown as SecretsService);
  });

  describe('signedImageExpiry', () => {
    it.each([
      ['2026-09-29T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
      ['2026-09-29T23:59:59.999Z', '2026-10-01T00:00:00.000Z'],
      ['2026-09-30T00:00:00.001Z', '2026-10-02T00:00:00.000Z'],
    ])('signs at %s until %s, the end of the next UTC day', (at, until) => {
      expect(signedImageExpiry(new Date(at))).toBe(
        new Date(until).getTime() / 1000,
      );
    });
  });

  it('signs the account path, as Cloudflare checks it', async () => {
    await service.onModuleInit();

    const now = new Date('2026-09-29T12:00:00.000Z');
    const exp = new Date('2026-10-01T00:00:00.000Z').getTime() / 1000;
    const sig = createHmac('sha256', 'test-signing-key')
      .update(`/hash-1/image-1/public?exp=${exp}`)
      .digest('hex');

    expect(service.enabled).toBe(true);
    expect(service.signature('hash-1', 'image-1', 'public', now)).toBe(
      `exp=${exp}&sig=${sig}`,
    );
  });

  it.each([
    ['no secret', undefined],
    ['no key', {}],
    ['a blank key', { cloudflareImagesSigningKey: '  ' }],
    ['a key that is not text', { cloudflareImagesSigningKey: 7 }],
  ])('signs nothing with %s', async (_case, secret) => {
    getSecret.mockResolvedValue(secret);

    await service.onModuleInit();

    expect(service.enabled).toBe(false);
    expect(service.signature('hash-1', 'image-1', 'public')).toBeNull();
  });
});
