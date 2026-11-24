import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AssetIngressModule } from 'src/file-assets/asset-ingress.module';
import { NotificationModule } from 'src/notification/notification.module';
import { RegistryModule } from 'src/registry/registry.module';

import { CaptainsLogAdminController } from './captains-log-admin.controller';
import { CaptainsLogController } from './captains-log.controller';
import { CaptainsLogService } from './captains-log.service';
import { LogEntryEntity } from './entities/log-entry.entity';
import { LogPicturePublisher } from './log-picture.publisher';
import { PublicCaptainsLogController } from './public-captains-log.controller';

/**
 * The Captain's Log (sc-1450).
 */
@Module({
  imports: [
    AssetIngressModule,
    NotificationModule,
    RegistryModule,
    TypeOrmModule.forFeature([LogEntryEntity]),
  ],
  controllers: [
    CaptainsLogController,
    PublicCaptainsLogController,
    CaptainsLogAdminController,
  ],
  providers: [CaptainsLogService, LogPicturePublisher],
  exports: [CaptainsLogService],
})
export class CaptainsLogModule {}
