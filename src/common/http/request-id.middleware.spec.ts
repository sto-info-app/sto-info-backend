import { jest } from '@jest/globals';
import * as Sentry from '@sentry/nestjs';
import { randomUUID } from 'crypto';
import type { NextFunction, Response } from 'express';
import {
  RequestIdMiddleware,
  type RequestWithId,
} from './request-id.middleware';

jest.mock('crypto', () => ({
  randomUUID: jest.fn(),
}));

jest.mock('@sentry/nestjs', () => ({
  setTag: jest.fn(),
}));

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let mockReq: Partial<RequestWithId>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  const mockUuid = 'test-uuid-1234';

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    mockReq = {
      header: jest.fn(),
    };
    mockRes = {
      setHeader: jest.fn(),
    };
    mockNext = jest.fn();
    (randomUUID as jest.Mock).mockReturnValue(mockUuid);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should generate a new requestId if x-request-id header is missing', () => {
    (mockReq.header as jest.Mock).mockReturnValue(undefined);

    middleware.use(mockReq as RequestWithId, mockRes as Response, mockNext);

    expect(mockReq.requestId).toBe(mockUuid);
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', mockUuid);
    expect(Sentry.setTag).toHaveBeenCalledWith('request_id', mockUuid);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should use existing requestId if x-request-id header is present', () => {
    const existingId = 'existing-id-5678';
    (mockReq.header as jest.Mock).mockReturnValue(existingId);

    middleware.use(mockReq as RequestWithId, mockRes as Response, mockNext);

    expect(mockReq.requestId).toBe(existingId);
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', existingId);
    expect(Sentry.setTag).toHaveBeenCalledWith('request_id', existingId);
    expect(randomUUID).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();
  });

  it('should trim existing requestId if x-request-id header has whitespace', () => {
    const existingId = '  trimmed-id-999  ';
    (mockReq.header as jest.Mock).mockReturnValue(existingId);

    middleware.use(mockReq as RequestWithId, mockRes as Response, mockNext);

    expect(mockReq.requestId).toBe('trimmed-id-999');
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      'trimmed-id-999',
    );
    expect(Sentry.setTag).toHaveBeenCalledWith('request_id', 'trimmed-id-999');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should call next after setting requestId', () => {
    middleware.use(mockReq as RequestWithId, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
  });
});
