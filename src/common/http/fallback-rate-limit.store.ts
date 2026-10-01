import { Logger } from '@nestjs/common';

import type {
  ClientRateLimitInfo,
  IncrementResponse,
  Options,
  Store,
} from 'express-rate-limit';

/** How long a rate-limit count may wait on Redis before it is counted here. */
export const RATE_LIMIT_STORE_TIMEOUT_MS = 1_000;

/** How long after Redis fails the limiter counts here before asking again. */
export const RATE_LIMIT_STORE_RETRY_MS = 10_000;

/**
 * A rate-limit store that counts in Redis, and in the instance's own memory
 * while Redis cannot answer (FC-042).
 *
 * Every request passes a limiter before it reaches a route, so a limiter that
 * waits on Redis takes the whole API down with it: ioredis holds a command
 * through twenty reconnection attempts, about seventy seconds, and then
 * fails it. That included Scan Diagnostics and the publication pause, the
 * pages a site admin is sent to during exactly that outage.
 *
 * Steve's decision of 1 October 2026: rather than stop limiting, count
 * locally. A count Redis has not answered within a second is made in memory
 * instead, and for the next ten seconds nothing asks Redis at all, so one
 * outage costs one slow request every ten seconds rather than a second on
 * every request. Limits still apply, sign-in's included; for the length of
 * the outage each instance keeps its own count rather than a shared one.
 * The switch is logged once each way.
 */
export class FallbackRateLimitStore implements Store {
  private readonly _logger = new Logger(FallbackRateLimitStore.name);

  /** Until when Redis is left alone, as epoch milliseconds; 0 while in use. */
  private _redisDownUntil = 0;

  /** Whether counts are being made here rather than in Redis. */
  private _counting = false;

  /**
   * Creates an instance of FallbackRateLimitStore.
   *
   * @param _redis - The shared store.
   * @param _memory - This instance's own store.
   * @param _label - Which limiter this is, for the log.
   * @param _now - The clock, as epoch milliseconds.
   */
  constructor(
    private readonly _redis: Store,
    private readonly _memory: Store,
    private readonly _label: string,
    private readonly _now: () => number = Date.now,
  ) {}

  /**
   * Passes the limiter's options to both stores.
   *
   * @param options - The limiter's options.
   */
  async init(options: Options): Promise<void> {
    await this._memory.init?.(options);
    await this.ask(() => this._redis.init?.(options), 'init');
  }

  /**
   * Reads a client's count.
   *
   * @param key - The client.
   * @returns Its count, where there is one.
   */
  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    return this.either(
      () => this._redis.get?.(key),
      () => this._memory.get?.(key),
      'get',
    );
  }

  /**
   * Counts one more request.
   *
   * @param key - The client.
   * @returns The count, and when it resets.
   */
  async increment(key: string): Promise<IncrementResponse> {
    return this.either(
      () => this._redis.increment(key),
      () => this._memory.increment(key),
      'increment',
    );
  }

  /**
   * Takes one request back off the count.
   *
   * @param key - The client.
   */
  async decrement(key: string): Promise<void> {
    await this.either(
      () => this._redis.decrement(key),
      () => this._memory.decrement(key),
      'decrement',
    );
  }

  /**
   * Clears a client's count.
   *
   * @param key - The client.
   */
  async resetKey(key: string): Promise<void> {
    await this.either(
      () => this._redis.resetKey(key),
      () => this._memory.resetKey(key),
      'resetKey',
    );
  }

  /**
   * Clears every count in both stores.
   */
  async resetAll(): Promise<void> {
    await this._memory.resetAll?.();
    await this.ask(() => this._redis.resetAll?.(), 'resetAll');
  }

  /**
   * Stops both stores.
   */
  async shutdown(): Promise<void> {
    await this._memory.shutdown?.();
    await this.ask(() => this._redis.shutdown?.(), 'shutdown');
  }

  /**
   * Asks Redis, or this instance's memory when Redis cannot answer.
   *
   * @param redis - The question for Redis.
   * @param memory - The same question for memory.
   * @param operation - What is being asked, for the log.
   * @returns The answer.
   */
  private async either<T>(
    redis: () => Promise<T> | T,
    memory: () => Promise<T> | T,
    operation: string,
  ): Promise<T> {
    if (this._now() >= this._redisDownUntil) {
      const answer = await this.ask(redis, operation);

      if (answer.answered) {
        return answer.value;
      }
    }

    return memory();
  }

  /**
   * Asks Redis within the time allowed, noting whether it answered.
   *
   * @param question - What to ask.
   * @param operation - What is being asked, for the log.
   * @returns The answer, or that there was none.
   */
  private async ask<T>(
    question: () => Promise<T> | T,
    operation: string,
  ): Promise<{ answered: true; value: T } | { answered: false }> {
    let timer: NodeJS.Timeout | undefined;

    try {
      const pending = Promise.resolve().then(question);

      // A command ioredis is still holding fails long after this has given
      // up on it; that failure is nobody's to handle.
      pending.catch(() => undefined);

      const value = await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Timed out')),
            RATE_LIMIT_STORE_TIMEOUT_MS,
          );
        }),
      ]);

      this.recovered();

      return { answered: true, value };
    } catch (error) {
      this.failed(operation, error);

      return { answered: false };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Notes that Redis did not answer, and counts here for a while.
   *
   * @param operation - What was being asked.
   * @param error - Why it did not answer.
   */
  private failed(operation: string, error: unknown): void {
    this._redisDownUntil = this._now() + RATE_LIMIT_STORE_RETRY_MS;

    if (this._counting) {
      return;
    }

    this._counting = true;
    this._logger.warn(
      `[${operation}] Rate limits counted in memory while Redis cannot ` +
        `answer - Limiter: ${this._label}, ` +
        `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }

  /**
   * Notes that Redis answered, and says so if counts had moved here.
   */
  private recovered(): void {
    this._redisDownUntil = 0;

    if (!this._counting) {
      return;
    }

    this._counting = false;
    this._logger.log(
      `[recovered] Rate limits counted in Redis again - Limiter: ${this._label}`,
    );
  }
}
