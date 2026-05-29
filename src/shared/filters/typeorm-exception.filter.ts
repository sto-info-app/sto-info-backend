import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { TypeORMError } from 'typeorm';

@Catch(TypeORMError)
export class TypeOrmExceptionFilter implements ExceptionFilter {
  /**
   * Handles the thrown exception.
   *
   * @param exception - The exception.
   * @param host - The execution host.
   * @returns The result of the operation.
   */
  catch(exception: TypeORMError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    new Logger(TypeOrmExceptionFilter.name).error(
      `TypeORM error on ${request.method} ${request.url}: ${exception.message}`,
      exception.stack,
    );

    Sentry.withScope(scope => {
      scope.setTag('layer', 'typeorm-filter');
      scope.setTag('db', 'postgres');

      scope.setContext('request', {
        method: request.method,
        path: request.url,
      });

      const requestId = request.headers?.['x-request-id'] || request.id;
      if (requestId) {
        scope.setTag('request_id', String(requestId));
      }

      Sentry.captureException(exception);
    });

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database error',
    });
  }
}
