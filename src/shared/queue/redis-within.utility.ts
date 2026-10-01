/**
 * How long a read or a command against Redis may take before it is given up
 * on, in milliseconds (FC-042).
 *
 * BullMQ's connections retry for ever (`maxRetriesPerRequest: null`), so
 * while Redis is down a command is held until it comes back rather than
 * failing. Anything a site admin is waiting for — Scan Diagnostics, the
 * failed jobs, the publication switch — and the minute's alert run must not
 * wait with it.
 */
export const REDIS_TIMEOUT_MS = 5_000;

/** Redis did not answer in time. */
export class RedisTimeoutError extends Error {
  /**
   * Creates an instance of RedisTimeoutError.
   *
   * @param ms - How long it was given.
   */
  constructor(ms: number) {
    super(`Redis did not answer within ${ms} ms`);
    this.name = 'RedisTimeoutError';
  }
}

/**
 * Asks Redis something, giving up after a while.
 *
 * The question is not cancelled — a held command still runs when Redis
 * comes back — but nobody waits for it, and a late failure is swallowed
 * rather than left as an unhandled rejection.
 *
 * @param ask - The question.
 * @param ms - How long to wait.
 * @returns The answer.
 * @throws RedisTimeoutError when it takes longer than that.
 * @throws Error whatever the question itself throws in time.
 */
export async function redisWithin<T>(
  ask: () => Promise<T>,
  ms = REDIS_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const answer = ask();
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RedisTimeoutError(ms)), ms);
  });

  // Whichever loses the race must not surface later as unhandled.
  answer.catch(() => undefined);

  try {
    return await Promise.race([answer, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
