import { getHeapStatistics } from 'node:v8';

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Records bounded process diagnostics without retaining request or user data.
 */
@Injectable()
export class MemoryDiagnosticsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly _logger = new Logger(MemoryDiagnosticsService.name);
  private timer?: NodeJS.Timeout;
  private enabled = false;
  private baseline?: { rss: number; heapUsed: number };
  private previous?: { rss: number; heapUsed: number };
  private requests = 0;
  private authenticatedRequests = 0;
  private appStateRequests = 0;
  private cronExecutions = 0;

  /**
   * Creates an instance of MemoryDiagnosticsService.
   *
   * @param _configService - The environment configuration service.
   */
  constructor(private readonly _configService: ConfigService) {}

  /**
   * Starts sampling after module initialisation.
   *
   * The diagnostic timer does not keep the Node.js process alive.
   */
  onApplicationBootstrap(): void {
    this.enabled =
      this._configService.get<string>('MEMORY_DIAGNOSTICS_ENABLED') === 'true';
    if (!this.enabled || this.timer) return;
    const minutes = Number(
      this._configService.get<string>('MEMORY_DIAGNOSTICS_INTERVAL_MINUTES') ??
        '10',
    );
    this.logMemory('startup');
    this.timer = setInterval(
      () => this.logMemory('interval'),
      minutes * 60_000,
    );
    this.timer.unref();
  }

  /**
   * Stops sampling when Nest closes the application.
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.enabled = false;
  }

  /**
   * Counts a request admitted by the route guards.
   *
   * @param authenticated - Whether authentication populated the request user.
   * @param appState - Whether the handler is the application-state GET endpoint.
   */
  recordRequest(authenticated: boolean, appState: boolean): void {
    if (!this.enabled) return;
    this.requests++;
    if (authenticated) this.authenticatedRequests++;
    if (appState) this.appStateRequests++;
  }

  /**
   * Counts an individual cleanup job attempt, including attempts that fail.
   */
  recordCronExecution(): void {
    if (this.enabled) this.cronExecutions++;
  }

  /**
   * Emits one JSON log message, retaining only baseline and previous memory scalars.
   *
   * Cron samples do not reset activity counts or the periodic comparison baseline.
   *
   * @param reason - A fixed application label; never request or user input.
   */
  logMemory(reason: string): void {
    if (!this.enabled) return;
    const memory = process.memoryUsage();
    const heap = getHeapStatistics();
    const current = { rss: memory.rss, heapUsed: memory.heapUsed };
    this.baseline ??= current;
    const previous = this.previous ?? current;
    this._logger.log(
      JSON.stringify({
        reason,
        uptimeSeconds: Math.round(process.uptime()),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
        v8UsedHeapBytes: heap.used_heap_size,
        v8TotalHeapBytes: heap.total_heap_size,
        heapLimitBytes: heap.heap_size_limit,
        mallocedBytes: heap.malloced_memory,
        v8ExternalBytes: heap.external_memory,
        rssDeltaBytes: memory.rss - previous.rss,
        heapUsedDeltaBytes: memory.heapUsed - previous.heapUsed,
        rssSinceStartupBytes: memory.rss - this.baseline.rss,
        heapUsedSinceStartupBytes: memory.heapUsed - this.baseline.heapUsed,
        requestsSinceLastSample: this.requests,
        authenticatedRequestsSinceLastSample: this.authenticatedRequests,
        appStateRequestsSinceLastSample: this.appStateRequests,
        cronExecutionsSinceLastSample: this.cronExecutions,
      }),
    );
    if (reason === 'startup' || reason === 'interval') this.previous = current;
    if (reason === 'interval') {
      this.requests = 0;
      this.authenticatedRequests = 0;
      this.appStateRequests = 0;
      this.cronExecutions = 0;
    }
  }
}
