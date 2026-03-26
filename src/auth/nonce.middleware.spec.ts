import { jest } from '@jest/globals';
import { NextFunction, Request, Response } from 'express';

import { NonceMiddleware } from './nonce.middleware';

describe('NonceMiddleware', () => {
  let middleware: NonceMiddleware;

  beforeEach(() => {
    middleware = new NonceMiddleware();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  it('should generate a nonce and attach it to res.locals', () => {
    const req = {} as Request;
    const res = { locals: {} } as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(req, res, next);

    expect(res.locals.nonce).toBeDefined();
    expect(typeof res.locals.nonce).toBe('string');
    expect(res.locals.nonce.length).toBeGreaterThan(0);
    expect(next).toHaveBeenCalled();
  });
});
