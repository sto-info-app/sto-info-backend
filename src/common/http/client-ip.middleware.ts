import type { NextFunction, Request, Response } from 'express';
import { getClientIp } from './client-ip.utility';

declare module 'express-serve-static-core' {
  interface Request {
    clientIp?: string;
  }
}

/**
 * Adds the client IP to the request.
 *
 * @param req - The request object.
 * @param _res - The response object.
 * @param next - The next middleware function.
 * @returns The result of the operation.
 */
export function clientIpMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  req.clientIp = getClientIp(req);
  next();
}
