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
      ['2026-09-29T12:00:00.000Z', '2026-09-29T14:00:00.000Z'],
      ['2026-09-29T12:59:59.999Z', '2026-09-29T14:00:00.000Z'],
      ['2026-09-29T13:00:00.001Z', '2026-09-29T15:00:00.000Z'],
      ['2026-09-29T23:30:00.000Z', '2026-09-30T01:00:00.000Z'],
    ])('signs at %s until %s, the end of the next UTC hour', (at, until) => {
      expect(signedImageExpiry(new Date(at))).toBe(
        new Date(until).getTime() / 1000,
      );
    });
  });

  it('signs the account path, as Cloudflare checks it', async () => {
    await service.onModuleInit();

    const now = new Date('2026-09-29T12:00:00.000Z');
    const exp = new Date('2026-09-29T14:00:00.000Z').getTime() / 1000;
    const sig = createHmac('sha256', 'test-signing-key')
      .update(`/hash-1/image-1/public?exp=${exp}`)
      .digest('hex');

    expect(service.enabled).toBe(true);
    expect(service.signature('hash-1', 'image-1', 'public', now)).toBe(
      `exp=${exp}&sig=${sig}`,
    );
  });

  describe('isGenuine', () => {
    const exp = '1790726400';
    const sig = createHmac('sha256', 'test-signing-key')
      .update(`/hash-1/image-1/public?exp=${exp}`)
      .digest('hex');

    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('knows an address this key signed, expired or not', () => {
      expect(service.isGenuine('hash-1', 'image-1', 'public', exp, sig)).toBe(
        true,
      );
    });

    it.each([
      ['another image', 'image-2', 'public', exp, sig],
      ['another variant', 'image-1', 'square100', exp, sig],
      ['another expiry', 'image-1', 'public', '1790730000', sig],
      ['a changed signature', 'image-1', 'public', exp, `${sig.slice(1)}0`],
      ['a short signature', 'image-1', 'public', exp, sig.slice(2)],
      ['an expiry that is not a number', 'image-1', 'public', '1e9', sig],
      [
        'capitals in the signature',
        'image-1',
        'public',
        exp,
        sig.toUpperCase(),
      ],
    ])('refuses %s', (_case, imageId, variant, anExp, aSig) => {
      expect(service.isGenuine('hash-1', imageId, variant, anExp, aSig)).toBe(
        false,
      );
    });

    it('refuses everything without a key', async () => {
      getSecret.mockResolvedValue({});
      await service.onModuleInit();

      expect(service.isGenuine('hash-1', 'image-1', 'public', exp, sig)).toBe(
        false,
      );
    });
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
