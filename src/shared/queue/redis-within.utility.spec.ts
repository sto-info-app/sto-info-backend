import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import {
  REDIS_TIMEOUT_MS,
  RedisTimeoutError,
  redisWithin,
} from './redis-within.utility';

describe('redisWithin (FC-042)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers with what Redis answered in time', async () => {
    await expect(redisWithin(() => Promise.resolve(3))).resolves.toBe(3);
  });

  it('passes on what Redis threw in time', async () => {
    const failure = new Error('NOAUTH');

    await expect(redisWithin(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
  });

  // BullMQ holds a command while Redis is down rather than failing it.
  it('gives up on a Redis that never answers', async () => {
    const asked = redisWithin(() => new Promise<number>(() => {}));
    const outcome = expect(asked).rejects.toThrow(
      new RedisTimeoutError(REDIS_TIMEOUT_MS),
    );

    await jest.advanceTimersByTimeAsync(REDIS_TIMEOUT_MS);
    await outcome;
  });

  it('takes a shorter limit, and swallows a failure that comes too late', async () => {
    let fail: (error: Error) => void = () => {};
    const asked = redisWithin(
      () =>
        new Promise<number>((_resolve, reject) => {
          fail = reject;
        }),
      100,
    );
    const outcome = expect(asked).rejects.toBeInstanceOf(RedisTimeoutError);

    await jest.advanceTimersByTimeAsync(100);
    await outcome;

    // Unhandled, this would fail the run.
    fail(new Error('connection closed'));
    await Promise.resolve();
  });
});
