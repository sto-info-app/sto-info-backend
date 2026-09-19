import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MemoryDiagnosticsService } from './memory-diagnostics.service';

describe('MemoryDiagnosticsService', () => {
  let service: MemoryDiagnosticsService;
  let log: jest.SpyInstance;
  let memory: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    memory = jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 100,
      heapUsed: 50,
      heapTotal: 80,
      external: 10,
      arrayBuffers: 5,
    });
    service = new MemoryDiagnosticsService(
      new ConfigService({ MEMORY_DIAGNOSTICS_ENABLED: 'true' }),
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('does no sampling or counting when disabled by default', () => {
    service = new MemoryDiagnosticsService(new ConfigService({}));
    service.onApplicationBootstrap();
    service.recordRequest(true, true);
    service.recordCronExecution();
    service.logMemory('manual');
    jest.advanceTimersByTime(600_000);
    expect(memory).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('emits startup and ten-minute samples with bounded baselines and interval-only counter resets', () => {
    service.onApplicationBootstrap();
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      reason: 'startup',
      rssDeltaBytes: 0,
      heapUsedDeltaBytes: 0,
      heapLimitBytes: expect.any(Number),
      mallocedBytes: expect.any(Number),
      v8ExternalBytes: expect.any(Number),
      v8UsedHeapBytes: expect.any(Number),
      v8TotalHeapBytes: expect.any(Number),
      uptimeSeconds: expect.any(Number),
    });
    service.recordRequest(true, true);
    service.recordRequest(false, false);
    service.recordCronExecution();
    memory.mockReturnValue({
      rss: 130,
      heapUsed: 70,
      heapTotal: 90,
      external: 11,
      arrayBuffers: 6,
    });
    service.logMemory('audit-cleanup:before');
    service.logMemory('audit-cleanup:after');
    jest.advanceTimersByTime(599_999);
    expect(log).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(1);
    expect(JSON.parse(log.mock.calls[3][0])).toMatchObject({
      reason: 'interval',
      rssBytes: 130,
      heapUsedBytes: 70,
      heapTotalBytes: 90,
      externalBytes: 11,
      arrayBuffersBytes: 6,
      rssDeltaBytes: 30,
      heapUsedDeltaBytes: 20,
      rssSinceStartupBytes: 30,
      heapUsedSinceStartupBytes: 20,
      requestsSinceLastSample: 2,
      authenticatedRequestsSinceLastSample: 1,
      appStateRequestsSinceLastSample: 1,
      cronExecutionsSinceLastSample: 1,
    });
    memory.mockReturnValue({
      rss: 120,
      heapUsed: 60,
      heapTotal: 90,
      external: 11,
      arrayBuffers: 6,
    });
    jest.advanceTimersByTime(600_000);
    expect(JSON.parse(log.mock.calls[4][0])).toMatchObject({
      rssDeltaBytes: -10,
      heapUsedDeltaBytes: -10,
      rssSinceStartupBytes: 20,
      heapUsedSinceStartupBytes: 10,
      requestsSinceLastSample: 0,
      authenticatedRequestsSinceLastSample: 0,
      appStateRequestsSinceLastSample: 0,
      cronExecutionsSinceLastSample: 0,
    });
  });

  it('uses the configured interval, unreferences its single timer, and stops on shutdown', () => {
    service = new MemoryDiagnosticsService(
      new ConfigService({
        MEMORY_DIAGNOSTICS_ENABLED: 'true',
        MEMORY_DIAGNOSTICS_INTERVAL_MINUTES: '2',
      }),
    );
    const interval = jest.spyOn(global, 'setInterval');
    service.onApplicationBootstrap();
    service.onApplicationBootstrap();
    expect(interval).toHaveBeenCalledTimes(1);
    expect(interval.mock.results[0].value.hasRef()).toBe(false);
    jest.advanceTimersByTime(120_000);
    expect(log).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    service.onModuleDestroy();
    jest.advanceTimersByTime(600_000);
    expect(log).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });
});
