import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { FileAssetsModule } from 'src/file-assets/file-assets.module';

import {
  FILE_SCAN_REQUEST_QUEUE,
  FILE_SCAN_VERDICT_QUEUE,
} from './contract/file-scan-contract';
import { ScanVerdictProcessor } from './processors/scan-verdict.processor';
import { ScanRequestProducerService } from './services/scan-request-producer.service';
import { ScanVerdictService } from './services/scan-verdict.service';

/**
 * The backend's end of the scanning contract.
 *
 * A module of its own rather than part of `FileAssetsModule`, because the
 * registry and the queue are different concerns with different failure
 * modes: the registry is a table this application owns outright, and this is
 * a conversation with another application over infrastructure that can be
 * down. Keeping them apart means the delivery endpoint does not depend on
 * Redis in order to serve a file.
 *
 * Both queues are registered, and the asymmetry mirrors the worker's exactly:
 * this process writes the request queue and consumes the verdict queue, and
 * the worker does the opposite. Neither has a processor on the other's side,
 * so neither can act on its own messages.
 *
 * Redis is already a dependency of this application for rate limiting, and
 * ADR-0006 was explicit that the queue's connection budget is sized and
 * monitored separately from it. The connection configured here is therefore
 * its own, built from the same `REDIS_URL` rather than shared with the
 * limiter's client.
 */
@Module({
  imports: [
    ConfigModule,
    FileAssetsModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: { url: configService.get<string>('REDIS_URL') },
        prefix: configService.get<string>('QUEUE_PREFIX') ?? 'bull:sto-info:',
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: FILE_SCAN_REQUEST_QUEUE },
      { name: FILE_SCAN_VERDICT_QUEUE },
    ),
  ],
  providers: [
    ScanRequestProducerService,
    ScanVerdictService,
    ScanVerdictProcessor,
  ],
  exports: [ScanRequestProducerService, ScanVerdictService],
})
export class FileScanningModule {}
