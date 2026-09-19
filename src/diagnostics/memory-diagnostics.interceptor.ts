import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';

import type { Request } from 'express';
import { Observable } from 'rxjs';

import { AppStateController } from 'src/notification/app-state.controller';

import { MemoryDiagnosticsService } from './memory-diagnostics.service';

/**
 * Counts admitted requests without adding response callbacks or retaining objects.
 */
@Injectable()
export class MemoryDiagnosticsInterceptor implements NestInterceptor {
  /**
   * Creates an instance of MemoryDiagnosticsInterceptor.
   *
   * @param _diagnostics - The shared process diagnostics service.
   */
  constructor(private readonly _diagnostics: MemoryDiagnosticsService) {}

  /**
   * Records primitive flags before passing control to the handler.
   *
   * @param context - Current execution context.
   * @param next - Remaining request pipeline.
   * @returns The unchanged handler stream.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest<Request>();
      this._diagnostics.recordRequest(
        Boolean(request.user),
        request.method === 'GET' &&
          context.getClass() === AppStateController &&
          context.getHandler() === AppStateController.prototype.getAppState,
      );
    }
    return next.handle();
  }
}
