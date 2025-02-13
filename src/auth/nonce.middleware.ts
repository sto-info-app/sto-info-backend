import { Injectable, NestMiddleware } from '@nestjs/common';
import * as crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class NonceMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction) {
    // Generate a random nonce
    const nonce = crypto.randomBytes(16).toString('base64');

    // Attach it to response locals for later use
    res.locals.nonce = nonce;
    next();
  }
}
