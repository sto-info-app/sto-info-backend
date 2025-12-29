import { ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { TypeORMError } from 'typeorm';
import { TypeOrmExceptionFilter } from './typeorm-exception.filter';

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

  it('should return generic database error message', () => {
    const exception = new TypeORMError('Constraint violation');

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database error',
    });
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
