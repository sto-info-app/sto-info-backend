import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * The one Redis connection every queue in this application is built on.
 *
 * Extracted from `FileScanningModule`, which configured it when the scanning
 * contract was the only thing queued. Two modules now need queues — scanning
 * and asset publication — and neither may import the other: the registry is
 * written by the scanning module, and publication is driven by the registry.
 * A shared root avoids a circular import and, more importantly, avoids two
 * connection pools built from the same URL by two modules that each thought
 * they owned it.
 *
 * The connection is this application's own, built from `REDIS_URL` and not
 * shared with the rate limiter's client. ADR-0006 was explicit that the
 * queue's connection budget is sized and monitored separately from it.
 *
 * `BullModule.forRootAsync` registers globally, so importing this module
 * once puts the configuration in reach of every `registerQueue` in the
 * application. It is imported by both queue-owning modules regardless,
 * because a module that registers a queue should say what it depends on.
 */
@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: { url: configService.get<string>('REDIS_URL') },
        prefix: configService.get<string>('QUEUE_PREFIX') ?? 'bull:sto-info:',
      }),
      inject: [ConfigService],
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
