import { jest } from '@jest/globals';
import { ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { TypeORMError } from 'typeorm';
import { TypeOrmExceptionFilter } from './typeorm-exception.filter';

jest.mock('@sentry/nestjs', () => ({
  withScope: jest.fn(callback =>
    callback({
      setTag: jest.fn(),
      setContext: jest.fn(),
    }),
  ),
  captureException: jest.fn(),
}));

describe('TypeOrmExceptionFilter', () => {
  let filter: TypeOrmExceptionFilter;
  let mockArgumentsHost: ArgumentsHost;
  let mockResponse: any;
  let mockRequest: any;
  let mockCtx: any;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new TypeOrmExceptionFilter();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      method: 'POST',
      url: '/api/users',
      headers: {},
    };

    mockCtx = {
      getResponse: jest.fn().mockReturnValue(mockResponse),
      getRequest: jest.fn().mockReturnValue(mockRequest),
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue(mockCtx),
    } as any;

    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  it('should catch TypeORMError and return INTERNAL_SERVER_ERROR status', () => {
    const exception = new TypeORMError('Database connection failed');

    filter.catch(exception, mockArgumentsHost);

    expect(mockArgumentsHost.switchToHttp).toHaveBeenCalled();
    expect(mockCtx.getResponse).toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('should send error to Sentry with context', () => {
    const exception = new TypeORMError('Database error');
    const mockScope = {
      setTag: jest.fn(),
      setContext: jest.fn(),
    };
    (Sentry.withScope as jest.Mock).mockImplementationOnce(callback =>
      callback(mockScope),
    );

    filter.catch(exception, mockArgumentsHost);

    expect(Sentry.withScope).toHaveBeenCalled();
    expect(mockScope.setTag).toHaveBeenCalledWith('layer', 'typeorm-filter');
    expect(mockScope.setContext).toHaveBeenCalledWith('request', {
      method: 'POST',
      path: '/api/users',
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
  });

  it('should include request ID in Sentry from headers', () => {
    const exception = new TypeORMError('Database error');
    const mockScope = {
      setTag: jest.fn(),
      setContext: jest.fn(),
    };
    (Sentry.withScope as jest.Mock).mockImplementationOnce(callback =>
      callback(mockScope),
    );
    mockRequest.headers['x-request-id'] = 'req-123';

    filter.catch(exception, mockArgumentsHost);

    expect(mockScope.setTag).toHaveBeenCalledWith('request_id', 'req-123');
  });

  it('should include request ID in Sentry from request.id', () => {
    const exception = new TypeORMError('Database error');
    const mockScope = {
      setTag: jest.fn(),
      setContext: jest.fn(),
    };
    (Sentry.withScope as jest.Mock).mockImplementationOnce(callback =>
      callback(mockScope),
    );
    mockRequest.id = 'req-456';

    filter.catch(exception, mockArgumentsHost);

    expect(mockScope.setTag).toHaveBeenCalledWith('request_id', 'req-456');
  });

  it('should handle missing request ID', () => {
    const exception = new TypeORMError('Database error');
    const mockScope = {
      setTag: jest.fn(),
      setContext: jest.fn(),
    };
    (Sentry.withScope as jest.Mock).mockImplementationOnce(callback =>
      callback(mockScope),
    );

    filter.catch(exception, mockArgumentsHost);

    expect(mockScope.setTag).not.toHaveBeenCalledWith(
      'request_id',
      expect.any(String),
    );
  });

  it('should return generic database error message', () => {
    const exception = new TypeORMError('Constraint violation');

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database error',
    });
  });

  it('should handle missing headers object for request ID', () => {
    const exception = new TypeORMError('Database error');
    const mockScope = {
      setTag: jest.fn(),
      setContext: jest.fn(),
    };
    (Sentry.withScope as jest.Mock).mockImplementationOnce(callback =>
      callback(mockScope),
    );
    delete mockRequest.headers;
    mockRequest.id = 'fallback-id';

    filter.catch(exception, mockArgumentsHost);

    expect(mockScope.setTag).toHaveBeenCalledWith('request_id', 'fallback-id');
  });

  it('should log error with request details', () => {
    const exception = new TypeORMError('Test error');
    exception.stack = 'Error stack trace';

    filter.catch(exception, mockArgumentsHost);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'TypeORM error on POST /api/users: Test error',
      'Error stack trace',
    );
  });

  it('should handle exception without stack trace', () => {
    const exception = new TypeORMError('Error without stack');
    delete exception.stack;

    filter.catch(exception, mockArgumentsHost);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'TypeORM error on POST /api/users: Error without stack',
      undefined,
    );
    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('should work with different HTTP methods', () => {
    const exception = new TypeORMError('Query failed');
    mockRequest.method = 'GET';
    mockRequest.url = '/api/accounts';

    filter.catch(exception, mockArgumentsHost);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'TypeORM error on GET /api/accounts: Query failed',
      exception.stack,
    );
  });
});
