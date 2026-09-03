import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';

import * as Sentry from '@sentry/nestjs';
import type { NextFunction, Request, Response } from 'express';

export type RequestWithId = Request & { requestId: string };

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  /**
   * Runs the middleware.
   *
   * @param req - The request object.
   * @param res - The response object.
   * @param next - The next middleware function.
   * @returns The result of the operation.
   */
  use(req: RequestWithId, res: Response, next: NextFunction) {
    const inbound = req.header('x-request-id');
    const requestId =
      inbound && inbound.trim().length > 0 ? inbound.trim() : randomUUID();

    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    // Set request ID in Sentry for this request scope
    Sentry.setTag('request_id', requestId);

    next();
  }
}
