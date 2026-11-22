import { createServer, IncomingMessage } from 'node:http';

import { IoAdapter } from '@nestjs/platform-socket.io';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { Redis } from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

import {
  CLOUDFLARE_ORIGIN_HEADER,
  CloudflareOrigin,
} from 'src/common/http/cloudflare-origin';

import { ChatAdapterFactory, ChatIoAdapter } from './chat-io.adapter';

const SITE = 'https://startrekonline.info';

/** A Redis connection as the adapter uses it. */
interface FakeRedis {
  status: string;
  duplicate: jest.Mock<() => FakeRedis>;
  quit: jest.Mock<() => Promise<string>>;
}

/**
 * A Redis connection.
 *
 * @param status - Whether it is open.
 * @returns The connection.
 */
const redisOf = (status = 'ready'): FakeRedis => ({
  status,
  duplicate: jest.fn(),
  quit: jest.fn(async () => 'OK'),
});

/**
 * An upgrade request from an origin, or from none.
 *
 * @param origin - Where the page is.
 * @returns The request.
 */
const requestFrom = (origin?: string): IncomingMessage =>
  ({ headers: origin === undefined ? {} : { origin } }) as IncomingMessage;

describe('ChatIoAdapter', () => {
  let publisher: FakeRedis;
  let subscriber: FakeRedis;
  let redisAdapter: jest.Mock<ChatAdapterFactory>;
  let created: jest.SpiedFunction<IoAdapter['createIOServer']>;
  let adapter: ChatIoAdapter;
  const server = {} as Server;

  beforeEach(() => {
    publisher = redisOf();
    subscriber = redisOf();
    publisher.duplicate.mockReturnValue(subscriber);
    redisAdapter = jest.fn(() => 'the Redis adapter' as never);
    created = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue(server);
    adapter = new ChatIoAdapter(
      createServer() as never,
      [SITE],
      publisher as unknown as Redis,
      redisAdapter,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * The options the server was made with.
   *
   * @returns Them.
   */
  const options = (): ServerOptions =>
    created.mock.calls[0][1] as ServerOptions;

  it('makes the server with the Redis adapter, subscribing on a second connection', () => {
    expect(
      adapter.createIOServer(0, { path: '/chat/socket' } as ServerOptions),
    ).toBe(server);
    adapter.createIOServer(0);

    expect(publisher.duplicate).toHaveBeenCalledTimes(1);
    expect(redisAdapter).toHaveBeenCalledWith(
      publisher as unknown as Redis,
      subscriber as unknown as Redis,
    );
    expect(options()).toMatchObject({
      path: '/chat/socket',
      adapter: 'the Redis adapter',
    });
  });

  it('lets in the site’s own pages and scripts, and nobody else', () => {
    const answers: boolean[] = [];

    adapter.createIOServer(0);

    for (const origin of [SITE, undefined, 'https://elsewhere.example']) {
      options().allowRequest?.(requestFrom(origin), (_error, allowed) => {
        answers.push(allowed);
      });
    }

    expect(answers).toEqual([true, true, false]);
  });

  // FC-044: once the origin secret is set, a socket opens only through
  // Cloudflare, whatever page it says it is from.
  it('lets in only what came through Cloudflare, once that is required', () => {
    const behindCloudflare = new ChatIoAdapter(
      createServer() as never,
      [SITE],
      publisher as unknown as Redis,
      redisAdapter,
      new CloudflareOrigin('the-origin-secret'),
    );
    const through = {
      headers: {
        origin: SITE,
        [CLOUDFLARE_ORIGIN_HEADER]: 'the-origin-secret',
      },
    } as unknown as IncomingMessage;

    expect(behindCloudflare.allows(through)).toBe(true);
    expect(behindCloudflare.allows(requestFrom(SITE))).toBe(false);
    expect(behindCloudflare.allows(requestFrom())).toBe(false);
  });

  it('closes the server, then both Redis connections', async () => {
    const closed = jest
      .spyOn(IoAdapter.prototype, 'close')
      .mockResolvedValue(undefined);

    adapter.createIOServer(0);
    await adapter.close(server);

    expect(closed).toHaveBeenCalledWith(server);
    expect(publisher.quit).toHaveBeenCalled();
    expect(subscriber.quit).toHaveBeenCalled();
  });

  it('closes only what is still open', async () => {
    jest.spyOn(IoAdapter.prototype, 'close').mockResolvedValue(undefined);
    publisher.status = 'end';

    await adapter.close(server);

    expect(publisher.quit).not.toHaveBeenCalled();
  });
});
