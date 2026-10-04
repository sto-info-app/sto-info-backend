import type { IncomingMessage } from 'node:http';

import { Logger } from '@nestjs/common';

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import {
  CLOUDFLARE_ORIGIN_HEADER,
  CloudflareOrigin,
  normaliseIp,
} from './cloudflare-origin';

const SECRET = 'the-origin-secret';

/**
 * A request, as Express hands it on.
 *
 * @param headers - Its headers.
 * @param path - Its path.
 * @param remoteAddress - Its connection's peer.
 * @returns The request.
 */
const requestOf = (
  headers: Record<string, string> = {},
  path = '/fleet-communities',
  remoteAddress: string | null = '::ffff:10.0.0.7',
): Request =>
  ({
    headers,
    path,
    socket: remoteAddress === null ? undefined : { remoteAddress },
  }) as unknown as Request;

/** A response that records what it was told. */
const responseOf = () => {
  const response: {
    status: jest.Mock<(code: number) => unknown>;
    json: jest.Mock<(body: unknown) => unknown>;
  } = {
    status: jest.fn<(code: number) => unknown>(() => response),
    json: jest.fn<(body: unknown) => unknown>(() => response),
  };

  return response;
};

/**
 * Runs a request through the middleware.
 *
 * @param origin - The check.
 * @param request - The request.
 * @returns The response and whether the request went on.
 */
const through = (origin: CloudflareOrigin, request: Request) => {
  const response = responseOf();
  const next = jest.fn() as unknown as NextFunction;

  origin.middleware()(request, response as unknown as Response, next);

  return { response, next: next as unknown as jest.Mock };
};

describe('CloudflareOrigin', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('with the origin secret, as behind Cloudflare', () => {
    const origin = new CloudflareOrigin(SECRET);

    it('believes Cloudflare’s address for a request carrying the secret', () => {
      const request = requestOf({
        [CLOUDFLARE_ORIGIN_HEADER]: SECRET,
        'cf-connecting-ip': ' ::ffff:203.0.113.9 ',
        'x-forwarded-for': '198.51.100.1',
      });
      const { next } = through(origin, request);

      expect(next).toHaveBeenCalled();
      expect(request.clientIp).toBe('203.0.113.9');
    });

    it('takes the connection’s own peer when Cloudflare named nobody', () => {
      const request = requestOf({ [CLOUDFLARE_ORIGIN_HEADER]: SECRET });

      through(origin, request);

      expect(request.clientIp).toBe('10.0.0.7');
    });

    it.each([
      ['no secret', {}],
      ['a wrong secret', { [CLOUDFLARE_ORIGIN_HEADER]: 'guessed' }],
      [
        'forged addresses and no secret',
        { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9' },
      ],
    ])('refuses a request with %s', (_case, headers) => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const request = requestOf(headers);
      const { response, next } = through(origin, request);

      expect(next).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: 403,
        message: 'Forbidden',
        error: 'Forbidden',
      });
      expect(request.clientIp).toBeUndefined();
      warn.mockRestore();
    });

    it('lets Render’s health checks through, believing no header', () => {
      const request = requestOf(
        { 'cf-connecting-ip': '203.0.113.9' },
        '/health/ready',
      );
      const { next } = through(origin, request);

      expect(next).toHaveBeenCalled();
      expect(request.clientIp).toBe('10.0.0.7');
    });

    it('logs a run of refusals once a minute, with their count', () => {
      jest.useFakeTimers({ now: new Date('2026-10-02T12:00:00Z') });

      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const counting = new CloudflareOrigin(SECRET);

      try {
        through(counting, requestOf());
        through(counting, requestOf());
        through(counting, requestOf());
        jest.setSystemTime(new Date('2026-10-02T12:01:00Z'));
        through(counting, requestOf());

        expect(warn.mock.calls).toEqual([
          ['[refuse] Requests that bypassed Cloudflare refused - Count: 1'],
          ['[refuse] Requests that bypassed Cloudflare refused - Count: 3'],
        ]);
      } finally {
        jest.useRealTimers();
        warn.mockRestore();
      }
    });

    it('opens a chat socket only through Cloudflare', () => {
      expect(
        origin.allowsSocket(
          requestOf({ [CLOUDFLARE_ORIGIN_HEADER]: SECRET }) as IncomingMessage,
        ),
      ).toBe(true);
      expect(
        origin.allowsSocket(
          requestOf({
            [CLOUDFLARE_ORIGIN_HEADER]: [SECRET, SECRET] as never,
          }) as IncomingMessage,
        ),
      ).toBe(false);
      expect(origin.allowsSocket(requestOf() as IncomingMessage)).toBe(false);
      expect(origin.enforced).toBe(true);
    });
  });

  describe('without a secret, as on a developer’s machine', () => {
    const origin = new CloudflareOrigin(null);

    it('refuses nothing and believes no header', () => {
      const request = requestOf({
        [CLOUDFLARE_ORIGIN_HEADER]: SECRET,
        'cf-connecting-ip': '203.0.113.9',
        'x-forwarded-for': '198.51.100.1',
      });
      const { next } = through(origin, request);

      expect(next).toHaveBeenCalled();
      expect(request.clientIp).toBe('10.0.0.7');
      expect(origin.enforced).toBe(false);
      expect(origin.allowsSocket(request as IncomingMessage)).toBe(true);
    });

    it('treats an empty secret as none', () => {
      expect(new CloudflareOrigin('').enforced).toBe(false);
    });

    it('records an empty address when the connection has gone', () => {
      const request = requestOf({}, '/fleet-communities', null);

      through(origin, request);

      expect(request.clientIp).toBe('');
    });
  });

  it('normalises an IPv6-mapped IPv4 address, and nothing else', () => {
    expect(normaliseIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(normaliseIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normaliseIp('192.0.2.1')).toBe('192.0.2.1');
  });
});
