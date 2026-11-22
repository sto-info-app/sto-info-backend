import { createHmac } from 'crypto';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { SecretsService } from 'src/shared/secrets/secrets.service';

import { ImageAddressRenewalService } from './image-address-renewal.service';
import { ImageSigningService } from './image-signing.service';

const HASH = 'hash-1';
const CDN = `https://cdn.example.test/cdn-cgi/imagedelivery/${HASH}`;
const DIRECT = `https://imagedelivery.net/${HASH}`;
const NOW = new Date('2026-10-19T18:30:00.000Z');

/**
 * Signs an address as the API did, with the test key.
 *
 * @param root - Everything before the image ID.
 * @param imageId - The image.
 * @param variant - The variant.
 * @param expiry - When it expires.
 * @returns The signed address.
 */
function signed(
  root: string,
  imageId: string,
  variant: string,
  expiry: string,
): string {
  const exp = new Date(expiry).getTime() / 1000;
  const sig = createHmac('sha256', 'test-signing-key')
    .update(`/${HASH}/${imageId}/${variant}?exp=${exp}`)
    .digest('hex');

  return `${root}/${imageId}/${variant}?exp=${exp}&sig=${sig}`;
}

describe('ImageAddressRenewalService', () => {
  let renewal: ImageAddressRenewalService;
  const hashBefore = process.env.CLOUDFLARE_IMAGES_HASH;

  beforeEach(async () => {
    process.env.CLOUDFLARE_IMAGES_HASH = HASH;

    const signing = new ImageSigningService({
      getSecret: jest.fn(() =>
        Promise.resolve({ cloudflareImagesSigningKey: 'test-signing-key' }),
      ),
    } as unknown as SecretsService);

    await signing.onModuleInit();
    renewal = new ImageAddressRenewalService(signing);
  });

  afterEach(() => {
    process.env.CLOUDFLARE_IMAGES_HASH = hashBefore;
  });

  it('gives back the picture unsigned, on the host it was asked for, for the interceptor to sign', () => {
    expect(
      renewal.renew(
        [
          signed(CDN, 'image-1', 'square300', '2026-10-19T18:00:00.000Z'),
          signed(DIRECT, 'image-2', 'public', '2026-10-19T19:00:00.000Z'),
        ],
        NOW,
      ),
    ).toEqual([`${CDN}/image-1/square300`, `${DIRECT}/image-2/public`]);
  });

  it('renews an address up to a day after it expired, and no longer', () => {
    expect(
      renewal.renew(
        [
          signed(CDN, 'image-1', 'public', '2026-10-18T18:30:00.000Z'),
          signed(CDN, 'image-1', 'public', '2026-10-18T18:29:59.000Z'),
        ],
        NOW,
      ),
    ).toEqual([`${CDN}/image-1/public`, null]);
  });

  it.each([
    [
      'a signature this key did not make',
      `${CDN}/image-1/public?exp=1792440000&sig=${'0'.repeat(64)}`,
    ],
    [
      'a signature moved to another image',
      signed(CDN, 'image-1', 'public', '2026-10-19T18:00:00.000Z').replace(
        'image-1',
        'image-2',
      ),
    ],
    ['an unsigned address', `${CDN}/image-1/public`],
    ['an address with no signature', `${CDN}/image-1/public?exp=1792440000`],
    [
      "another account's picture",
      signed(CDN, 'image-1', 'public', '2026-10-19T18:00:00.000Z').replace(
        HASH,
        'hash-2',
      ),
    ],
    ['something else', 'https://example.test/picture.png'],
  ])('renews nothing for %s', (_case, address) => {
    expect(renewal.renew([address], NOW)).toEqual([null]);
  });

  it('renews nothing without the account hash', () => {
    delete process.env.CLOUDFLARE_IMAGES_HASH;

    expect(
      renewal.renew(
        [signed(CDN, 'image-1', 'public', '2026-10-19T18:00:00.000Z')],
        NOW,
      ),
    ).toEqual([null]);
  });

  it('judges the expiry against the present when not told when it is', () => {
    expect(
      renewal.renew([
        signed(CDN, 'image-1', 'public', '2099-01-01T00:00:00.000Z'),
        signed(CDN, 'image-1', 'public', '2026-01-01T00:00:00.000Z'),
      ]),
    ).toEqual([`${CDN}/image-1/public`, null]);
  });
});
