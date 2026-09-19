import { CallHandler, ExecutionContext } from '@nestjs/common';

import { of } from 'rxjs';

import { AppStateController } from 'src/notification/app-state.controller';

import { MemoryDiagnosticsInterceptor } from './memory-diagnostics.interceptor';
import { MemoryDiagnosticsService } from './memory-diagnostics.service';

describe('MemoryDiagnosticsInterceptor', () => {
  const recordRequest = jest.fn();
  const interceptor = new MemoryDiagnosticsInterceptor({
    recordRequest,
  } as unknown as MemoryDiagnosticsService);
  const stream = of('unchanged');
  const next: CallHandler = { handle: () => stream };

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [
      'GET',
      { id: 'test' },
      AppStateController,
      AppStateController.prototype.getAppState,
      true,
      true,
    ],
    [
      'GET',
      undefined,
      AppStateController,
      AppStateController.prototype.getAppState,
      false,
      true,
    ],
    [
      'HEAD',
      undefined,
      AppStateController,
      AppStateController.prototype.getAppState,
      false,
      false,
    ],
    [
      'GET',
      undefined,
      class OtherController {},
      AppStateController.prototype.getAppState,
      false,
      false,
    ],
    ['GET', undefined, AppStateController, () => undefined, false, false],
  ])(
    'classifies %s requests using route identity and authenticated user presence',
    (method, user, controller, handler, authenticated, appState) => {
      const context = {
        getType: () => 'http',
        switchToHttp: () => ({
          getRequest: () => ({ method, user, url: '/app-state?ignored=true' }),
        }),
        getClass: () => controller,
        getHandler: () => handler,
      } as unknown as ExecutionContext;
      expect(interceptor.intercept(context, next)).toBe(stream);
      expect(recordRequest).toHaveBeenCalledWith(authenticated, appState);
    },
  );

  it('passes non-HTTP calls through without counting', () => {
    const context = { getType: () => 'rpc' } as ExecutionContext;
    expect(interceptor.intercept(context, next)).toBe(stream);
    expect(recordRequest).not.toHaveBeenCalled();
  });
});
