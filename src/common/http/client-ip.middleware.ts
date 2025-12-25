import type { NextFunction, Request, Response } from 'express';
import { getClientIp } from './client-ip.utility';

declare module 'express-serve-static-core' {
  interface Request {
    clientIp?: string;
  }
}

export function clientIpMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  req.clientIp = getClientIp(req);
  next();
}
