import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import type { IncrementResponse, Options, Store } from 'express-rate-limit';

import {
  FallbackRateLimitStore,
  RATE_LIMIT_STORE_RETRY_MS,
  RATE_LIMIT_STORE_TIMEOUT_MS,
} from './fallback-rate-limit.store';

/** A store whose every method is a mock. */
type MockStore = {
  init: jest.Mock<Required<Store>['init']>;
  get: jest.Mock<Required<Store>['get']>;
  increment: jest.Mock<Store['increment']>;
  decrement: jest.Mock<Store['decrement']>;
  resetKey: jest.Mock<Store['resetKey']>;
  resetAll: jest.Mock<Required<Store>['resetAll']>;
  shutdown: jest.Mock<Required<Store>['shutdown']>;
  localKeys: boolean;
};

/** A count, as either store answers one. */
const COUNT: IncrementResponse = { totalHits: 1, resetTime: undefined };

/**
 * Builds a store that answers every question at once.
 *
 * @returns The store.
 */
function storeThatAnswers(): MockStore {
  return {
    init: jest.fn<Required<Store>['init']>(),
    get: jest.fn<Required<Store>['get']>().mockResolvedValue(undefined),
    increment: jest.fn<Required<Store>['increment']>().mockResolvedValue(COUNT),
    decrement: jest.fn<Required<Store>['decrement']>().mockResolvedValue(),
    resetKey: jest.fn<Required<Store>['resetKey']>().mockResolvedValue(),
    resetAll: jest.fn<Required<Store>['resetAll']>().mockResolvedValue(),
    shutdown: jest.fn<Required<Store>['shutdown']>().mockResolvedValue(),
    localKeys: false,
  };
}

describe('FallbackRateLimitStore', () => {
  let redis: MockStore;
  let memory: MockStore;
  let now: number;
  let store: FallbackRateLimitStore;
  let warn: jest.SpiedFunction<Logger['warn']>;
  let log: jest.SpiedFunction<Logger['log']>;

  beforeEach(() => {
    redis = storeThatAnswers();
    memory = storeThatAnswers();
    now = 1_000_000;
    store = new FallbackRateLimitStore(redis, memory, 'auth', () => now);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
    log.mockRestore();
  });

  describe('while Redis answers', () => {
    it('counts in Redis and leaves memory alone', async () => {
      await expect(store.increment('ip')).resolves.toBe(COUNT);
      await store.decrement('ip');
      await store.resetKey('ip');
      await store.get('ip');

      expect(redis.increment).toHaveBeenCalledWith('ip');
      expect(redis.decrement).toHaveBeenCalledWith('ip');
      expect(redis.resetKey).toHaveBeenCalledWith('ip');
      expect(redis.get).toHaveBeenCalledWith('ip');
      expect(memory.increment).not.toHaveBeenCalled();
      expect(memory.get).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('passes the options, a reset and a shutdown to both stores', async () => {
      const options = { windowMs: 60_000 } as Options;

      await store.init(options);
      await store.resetAll();
      await store.shutdown();

      expect(redis.init).toHaveBeenCalledWith(options);
      expect(memory.init).toHaveBeenCalledWith(options);
      expect(redis.resetAll).toHaveBeenCalled();
      expect(memory.resetAll).toHaveBeenCalled();
      expect(redis.shutdown).toHaveBeenCalled();
      expect(memory.shutdown).toHaveBeenCalled();
    });

    it('copes with stores that have none of the optional methods', async () => {
      const bare = new FallbackRateLimitStore(
        {
          increment: redis.increment,
          decrement: redis.decrement,
          resetKey: redis.resetKey,
        },
        {
          increment: memory.increment,
          decrement: memory.decrement,
          resetKey: memory.resetKey,
        },
        'read',
      );

      await expect(bare.init({} as Options)).resolves.toBeUndefined();
      await expect(bare.get('ip')).resolves.toBeUndefined();
      await expect(bare.resetAll()).resolves.toBeUndefined();
      await expect(bare.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('when Redis fails', () => {
    beforeEach(() => {
      redis.increment.mockRejectedValue(new Error('Connection is closed.'));
    });

    it('counts in memory, and says so once', async () => {
      await expect(store.increment('ip')).resolves.toBe(COUNT);
      await store.increment('ip');

      expect(memory.increment).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[increment] Rate limits counted in memory while Redis cannot ' +
          'answer - Limiter: auth, Reason: Connection is closed.',
      );
    });

    it('leaves Redis alone for a while rather than waiting on it each time', async () => {
      await store.increment('ip');
      await store.decrement('ip');
      await store.resetKey('ip');
      await store.get('ip');

      expect(redis.increment).toHaveBeenCalledTimes(1);
      expect(redis.decrement).not.toHaveBeenCalled();
      expect(redis.resetKey).not.toHaveBeenCalled();
      expect(redis.get).not.toHaveBeenCalled();
      expect(memory.decrement).toHaveBeenCalledWith('ip');
      expect(memory.resetKey).toHaveBeenCalledWith('ip');
      expect(memory.get).toHaveBeenCalledWith('ip');
    });

    it('asks Redis again once the wait is over, and says it is back', async () => {
      await store.increment('ip');
      redis.increment.mockResolvedValue(COUNT);
      now += RATE_LIMIT_STORE_RETRY_MS;

      await store.increment('ip');

      expect(redis.increment).toHaveBeenCalledTimes(2);
      expect(memory.increment).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        '[recovered] Rate limits counted in Redis again - Limiter: auth',
      );
    });

    it('keeps counting in memory when Redis fails again, without saying it twice', async () => {
      await store.increment('ip');
      now += RATE_LIMIT_STORE_RETRY_MS;

      await store.increment('ip');

      expect(redis.increment).toHaveBeenCalledTimes(2);
      expect(memory.increment).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('names an odd failure plainly', async () => {
      redis.increment.mockRejectedValue('boom');

      await store.increment('ip');

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Reason: unknown'),
      );
    });

    it('still starts, resets and stops when Redis cannot', async () => {
      redis.init.mockRejectedValue(new Error('down'));
      redis.resetAll.mockRejectedValue(new Error('down'));
      redis.shutdown.mockRejectedValue(new Error('down'));

      await expect(store.init({} as Options)).resolves.toBeUndefined();
      await expect(store.resetAll()).resolves.toBeUndefined();
      await expect(store.shutdown()).resolves.toBeUndefined();

      expect(memory.init).toHaveBeenCalled();
      expect(memory.resetAll).toHaveBeenCalled();
      expect(memory.shutdown).toHaveBeenCalled();
    });
  });

  describe('when Redis does not answer', () => {
    it('stops waiting after the time allowed and counts in memory', async () => {
      jest.useFakeTimers();

      let fail: (error: Error) => void = () => undefined;

      redis.increment.mockReturnValue(
        new Promise<IncrementResponse>((_resolve, reject) => {
          fail = reject;
        }),
      );

      const counted = store.increment('ip');

      await jest.advanceTimersByTimeAsync(RATE_LIMIT_STORE_TIMEOUT_MS);

      await expect(counted).resolves.toBe(COUNT);
      expect(memory.increment).toHaveBeenCalledWith('ip');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Reason: Timed out'),
      );

      // ioredis gives up on the command long afterwards; nothing hears of it.
      fail(new Error('MaxRetriesPerRequestError'));
      await jest.advanceTimersByTimeAsync(0);
    });
  });
});
