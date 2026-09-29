import { CallHandler, ExecutionContext } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { firstValueFrom, of } from 'rxjs';
import { DataSource } from 'typeorm';

import { FileAssetState } from '../enums/file-asset-state.enum';
import { ImageSigningService } from './image-signing.service';
import {
  IMAGE_UNAVAILABLE_ID,
  ImageUrlSigningInterceptor,
  readImageAddress,
} from './image-url-signing.interceptor';

const HASH = 'hash-1';
const CDN = `https://cdn.example.test/cdn-cgi/imagedelivery/${HASH}`;
const DIRECT = `https://imagedelivery.net/${HASH}`;

describe('ImageUrlSigningInterceptor (FC-040)', () => {
  let find: jest.Mock<(...args: unknown[]) => Promise<unknown[]>>;
  let signature: jest.Mock<(...args: unknown[]) => string | null>;
  let interceptor: ImageUrlSigningInterceptor;
  const before = process.env.CLOUDFLARE_IMAGES_HASH;

  beforeEach(() => {
    process.env.CLOUDFLARE_IMAGES_HASH = HASH;
    find = jest.fn(() =>
      Promise.resolve([
        { deliveryReference: 'shown', state: FileAssetState.AVAILABLE },
        { deliveryReference: 'legacy', state: FileAssetState.UNVERIFIED },
        { deliveryReference: 'gone', state: FileAssetState.REVOKED },
      ]),
    );
    signature = jest.fn(
      (_hash: unknown, id: unknown, variant: unknown) =>
        `exp=1&sig=${String(id)}-${String(variant)}`,
    );
    interceptor = new ImageUrlSigningInterceptor(
      { manager: { find } } as unknown as DataSource,
      { signature } as unknown as ImageSigningService,
    );
  });

  afterEach(() => {
    process.env.CLOUDFLARE_IMAGES_HASH = before;
  });

  /**
   * Runs a body through the interceptor.
   *
   * @param body - What the handler returned.
   * @returns What the browser gets.
   */
  const through = (body: unknown) =>
    firstValueFrom(
      interceptor.intercept(
        {} as ExecutionContext,
        {
          handle: () => of(body),
        } as CallHandler,
      ),
    );

  it('signs what may be shown, stands in for what may not, and leaves the site’s own artwork', async () => {
    const body = {
      profilePicture300: `${CDN}/shown/square300`,
      again: `${CDN}/shown/square300`,
      cast: [
        { portrait: `${DIRECT}/legacy/public` },
        { portrait: `${CDN}/gone/square100` },
      ],
      icon: `${CDN}/site-artwork/public`,
      text: 'Not an address',
      mention: `The account ${HASH} is ours`,
      count: 3,
      when: new Date('2026-09-29T00:00:00.000Z'),
      nothing: null,
    };

    const signed = (await through(body)) as typeof body;

    expect(signed).toEqual({
      profilePicture300: `${CDN}/shown/square300?exp=1&sig=shown-square300`,
      again: `${CDN}/shown/square300?exp=1&sig=shown-square300`,
      cast: [
        { portrait: `${DIRECT}/legacy/public?exp=1&sig=legacy-public` },
        { portrait: `${CDN}/${IMAGE_UNAVAILABLE_ID}/square100` },
      ],
      icon: `${CDN}/site-artwork/public`,
      text: 'Not an address',
      mention: `The account ${HASH} is ours`,
      count: 3,
      when: body.when,
      nothing: null,
    });
    // One query for the whole response, and the original left as it was.
    expect(find).toHaveBeenCalledTimes(1);
    expect(body.profilePicture300).toBe(`${CDN}/shown/square300`);
  });

  it('signs an address again rather than keeping a stale signature', async () => {
    await expect(
      through([`${CDN}/shown/public?exp=0&sig=old`]),
    ).resolves.toEqual([`${CDN}/shown/public?exp=1&sig=shown-public`]);
  });

  it('leaves an address unsigned when there is no key', async () => {
    signature.mockReturnValue(null);

    const body = { picture: `${CDN}/shown/public` };

    await expect(through(body)).resolves.toBe(body);
  });

  it('asks nothing of a response with no address in it', async () => {
    const body = { name: 'Kira', tags: ['a', 'b'] };

    await expect(through(body)).resolves.toBe(body);
    await expect(through('text')).resolves.toBe('text');
    await expect(through(null)).resolves.toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  it('leaves everything alone without an account hash', async () => {
    delete process.env.CLOUDFLARE_IMAGES_HASH;

    const body = { picture: `${CDN}/shown/public` };

    await expect(through(body)).resolves.toBe(body);
  });

  it('walks no deeper than it must', async () => {
    let deep: Record<string, unknown> = { picture: `${CDN}/shown/public` };

    for (let depth = 0; depth < 40; depth++) {
      deep = { next: deep };
    }

    await expect(through(deep)).resolves.toBe(deep);

    // The same address near the top is signed; the one too deep is not.
    const both = (await through({
      picture: `${CDN}/shown/public`,
      deep,
    })) as { picture: string; deep: unknown };

    expect(both.picture).toBe(`${CDN}/shown/public?exp=1&sig=shown-public`);
    expect(JSON.stringify(both.deep)).not.toContain('sig=');
  });

  it('leaves objects that are not plain data alone', async () => {
    class Holder {
      picture = `${CDN}/shown/public`;
    }

    const holder = new Holder();

    await expect(through({ holder })).resolves.toEqual({ holder });
  });

  describe('readImageAddress', () => {
    it.each([
      [`${CDN}/id-1/public`, { imageId: 'id-1', variant: 'public' }],
      [
        `${DIRECT}/id-1/square100?exp=1&sig=a`,
        { imageId: 'id-1', variant: 'square100' },
      ],
    ])('reads %s', (value, parts) => {
      expect(readImageAddress(value, HASH)).toEqual(
        expect.objectContaining(parts),
      );
    });

    it.each([
      `https://cdn.example.test/cdn-cgi/imagedelivery/other-hash/id-1/public`,
      `https://cdn.example.test/${HASH}/id-1/public`,
      `http://imagedelivery.net/${HASH}/id-1/public`,
      `${CDN}/id-1`,
      `${CDN}/id-1/public/extra`,
    ])('refuses %s', value => {
      expect(readImageAddress(value, HASH)).toBeNull();
    });
  });
});
