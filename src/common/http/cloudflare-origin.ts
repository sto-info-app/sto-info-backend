import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

import { HttpStatus, Logger } from '@nestjs/common';

import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    /**
     * The address the request came from, decided once by
     * {@link CloudflareOrigin}: what Cloudflare says when the request proves
     * it came through Cloudflare, otherwise the connection's own peer.
     */
    clientIp?: string;
  }
}

/**
 * The header Cloudflare adds to every request it forwards to the API, through
 * a Transform Rule, carrying the origin secret. Lower case, as Node holds it.
 */
export const CLOUDFLARE_ORIGIN_HEADER = 'x-origin-verify';

/**
 * Paths served without Cloudflare's proof: Render's health checks reach the
 * service directly, never through Cloudflare.
 */
export const ORIGIN_UNCHECKED_PATHS = ['/health/'] as const;

/** How often a run of refused requests is logged, in milliseconds. */
const REFUSAL_LOG_INTERVAL_MS = 60_000;

/**
 * Normalises an IPv6-mapped IPv4 address to plain IPv4.
 *
 * @param ip - The address.
 * @returns `::ffff:192.0.2.1` as `192.0.2.1`; anything else as it was.
 */
export function normaliseIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.substring(7) : ip;
}

/**
 * Hashes a value to a fixed length, so two values of any length can be
 * compared in constant time.
 *
 * @param value - The value.
 * @returns Its SHA-256 digest.
 */
const digest = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest();

/**
 * Tells a request that came through Cloudflare from one sent straight to the
 * origin, and decides whose address each is.
 *
 * `CF-Connecting-IP` and `X-Forwarded-For` are only headers: anybody who
 * reaches the origin without Cloudflare can write them, and every rate limit
 * keyed on them could be dodged with a new value per request. So a request is
 * believed only when it carries the secret Cloudflare adds on its way through
 * (Steve's decision of 2 October 2026), and anything else is refused, except
 * Render's health checks.
 *
 * Without a secret — on a developer's machine — nothing is refused and no
 * header is believed: every request's address is its connection's own.
 */
export class CloudflareOrigin {
  private readonly _logger = new Logger(CloudflareOrigin.name);
  private readonly _secret: Buffer | null;
  private _refused = 0;
  private _refusalsLoggedAt = 0;

  /**
   * Creates an instance of CloudflareOrigin.
   *
   * @param secret - The origin secret Cloudflare sends, or null where there
   *   is no Cloudflare in front.
   */
  constructor(secret: string | null) {
    this._secret = secret === null || secret === '' ? null : digest(secret);
  }

  /** Whether requests have to prove they came through Cloudflare. */
  get enforced(): boolean {
    return this._secret !== null;
  }

  /**
   * Whether a request carries Cloudflare's proof.
   *
   * @param headers - Its headers.
   * @returns True when it carries the secret.
   */
  verifies(headers: IncomingHttpHeaders): boolean {
    const offered = headers[CLOUDFLARE_ORIGIN_HEADER];

    return (
      this._secret !== null &&
      typeof offered === 'string' &&
      timingSafeEqual(digest(offered), this._secret)
    );
  }

  /**
   * The address a request came from.
   *
   * @param request - The request.
   * @returns Cloudflare's `CF-Connecting-IP` for a request proved to come
   *   through Cloudflare; otherwise the connection's own peer.
   */
  clientIp(request: IncomingMessage): string {
    const connecting = request.headers['cf-connecting-ip'];

    if (
      this.verifies(request.headers) &&
      typeof connecting === 'string' &&
      connecting.trim() !== ''
    ) {
      return normaliseIp(connecting.trim());
    }

    return normaliseIp(request.socket?.remoteAddress ?? '');
  }

  /**
   * Whether a chat socket may open: only through Cloudflare, once proof is
   * required.
   *
   * @param request - The upgrade request.
   * @returns True when it may.
   */
  allowsSocket(request: IncomingMessage): boolean {
    return !this.enforced || this.verifies(request.headers);
  }

  /**
   * The middleware: refuses a request that bypassed Cloudflare, and records
   * every other request's address on it.
   *
   * @returns The middleware.
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      if (
        this.enforced &&
        !this.verifies(req.headers) &&
        !ORIGIN_UNCHECKED_PATHS.some(path => req.path.startsWith(path))
      ) {
        this.noteRefusal();
        res.status(HttpStatus.FORBIDDEN).json({
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Forbidden',
          error: 'Forbidden',
        });

        return;
      }

      req.clientIp = this.clientIp(req);
      next();
    };
  }

  /**
   * Counts a refusal, and logs the count at most once a minute, so a flood
   * of them cannot flood the log as well.
   */
  private noteRefusal(): void {
    this._refused += 1;

    const now = Date.now();

    if (now - this._refusalsLoggedAt >= REFUSAL_LOG_INTERVAL_MS) {
      this._logger.warn(
        `[refuse] Requests that bypassed Cloudflare refused - Count: ${this._refused}`,
      );
      this._refused = 0;
      this._refusalsLoggedAt = now;
    }
  }
}
