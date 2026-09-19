import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { MemoryDiagnosticsInterceptor } from './memory-diagnostics.interceptor';
import { MemoryDiagnosticsService } from './memory-diagnostics.service';

/**
 * Provides the single process sampler and global request counter.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    MemoryDiagnosticsService,
    { provide: APP_INTERCEPTOR, useClass: MemoryDiagnosticsInterceptor },
  ],
  exports: [MemoryDiagnosticsService],
})
export class DiagnosticsModule {}
