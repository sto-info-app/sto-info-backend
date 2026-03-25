import { jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { clientIpMiddleware } from './client-ip.middleware';
import * as clientIpUtility from './client-ip.utility';

jest.mock('./client-ip.utility');

describe('clientIpMiddleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let getClientIpSpy: jest.SpyInstance;

  beforeEach(() => {
    mockReq = {
      header: jest.fn(),
      ip: '127.0.0.1',
    };
    mockRes = {};
    mockNext = jest.fn();
    getClientIpSpy = jest.spyOn(clientIpUtility, 'getClientIp');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should set clientIp on request object', () => {
    getClientIpSpy.mockReturnValue('192.168.1.1');

    clientIpMiddleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockReq.clientIp).toBe('192.168.1.1');
    expect(getClientIpSpy).toHaveBeenCalledWith(mockReq);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should call next after setting clientIp', () => {
    getClientIpSpy.mockReturnValue('10.0.0.1');

    clientIpMiddleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockReq.clientIp).toBe('10.0.0.1');
  });

  it('should handle IPv6 addresses', () => {
    getClientIpSpy.mockReturnValue('2001:db8::1');

    clientIpMiddleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockReq.clientIp).toBe('2001:db8::1');
    expect(mockNext).toHaveBeenCalled();
  });
});
