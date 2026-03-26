import { jest } from '@jest/globals';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

jest.mock('@sentry/nestjs', () => ({
  setTag: jest.fn(),
  captureException: jest.fn(),
}));

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let mockExecutionContext: Partial<ExecutionContext>;
  let mockCallHandler: Partial<CallHandler>;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    const mockHttp = {
      getRequest: jest.fn().mockReturnValue({
        method: 'GET',
        url: '/test',
      }),
      getResponse: jest.fn(),
      getNext: jest.fn(),
    };
    mockExecutionContext = {
      switchToHttp: jest
        .fn<(...args: any[]) => any>()
        .mockReturnValue(mockHttp),
      getClass: jest
        .fn<(...args: any[]) => any>()
        .mockReturnValue({ name: 'TestController' }),
      getHandler: jest
        .fn<(...args: any[]) => any>()
        .mockReturnValue({ name: 'testHandler' }),
    };
    mockCallHandler = {
      handle: jest
        .fn<(...args: any[]) => any>()
        .mockReturnValue(of('test-response')),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should log the successful request and set Sentry tags', done => {
    const loggerSpy = jest
      .spyOn((interceptor as any).logger, 'log')
      .mockImplementation(() => {});

    interceptor
      .intercept(
        mockExecutionContext as ExecutionContext,
        mockCallHandler as CallHandler,
      )
      .subscribe({
        next: () => {
          expect(Sentry.setTag).toHaveBeenCalledWith(
            'controller',
            'TestController',
          );
          expect(Sentry.setTag).toHaveBeenCalledWith('handler', 'testHandler');
          expect(loggerSpy).toHaveBeenCalledWith(
            expect.stringMatching(/GET \/test \d+ms/),
          );
          done();
        },
      });
  });

  it('should log failed requests and capture exception in Sentry', done => {
    const loggerSpy = jest
      .spyOn((interceptor as any).logger, 'error')
      .mockImplementation(() => {});
    const error = new Error('Test error');
    mockCallHandler.handle = jest
      .fn<(...args: any[]) => any>()
      .mockReturnValue(throwError(() => error));

    interceptor
      .intercept(
        mockExecutionContext as ExecutionContext,
        mockCallHandler as CallHandler,
      )
      .subscribe({
        error: err => {
          expect(err).toBe(error);
          expect(loggerSpy).toHaveBeenCalledWith(
            expect.stringMatching(/GET \/test \d+ms - Error: Test error/),
          );
          expect(Sentry.captureException).toHaveBeenCalledWith(error);
          done();
        },
      });
  });
});
