import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  /**
   * Intercepts the request pipeline.
   *
   * @param context - The execution context.
   * @param next - The next middleware function.
   * @returns The result of the operation.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const { method, url } = request;
    const now = Date.now();

    const controller = context.getClass().name;
    const handler = context.getHandler().name;

    // Add NestJS metadata to Sentry
    Sentry.setTag('controller', controller);
    Sentry.setTag('handler', handler);

    return next.handle().pipe(
      tap({
        next: () => {
          const timeout = Date.now() - now;
          this.logger.log(`${method} ${url} ${timeout}ms`);
        },
        error: err => {
          const timeout = Date.now() - now;
          this.logger.error(
            `${method} ${url} ${timeout}ms - Error: ${err.message}`,
          );
          // Manually capture the exception to ensure Sentry tracks it
          Sentry.captureException(err);
        },
      }),
    );
  }
}
