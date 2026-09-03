import * as crypto from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';

import { NextFunction, Request, Response } from 'express';

@Injectable()
export class NonceMiddleware implements NestMiddleware {
  /**
   * Runs the middleware.
   *
   * @param _req - The request object.
   * @param res - The response object.
   * @param next - The next middleware function.
   * @returns The result of the operation.
   */
  use(_req: Request, res: Response, next: NextFunction) {
    // Generate a random nonce
    const nonce = crypto.randomBytes(16).toString('base64');

    // Attach it to response locals for later use
    res.locals.nonce = nonce;
    next();
  }
}
