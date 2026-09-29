import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from 'src/user/user.module';

import { AppStateController } from './app-state.controller';
import { BannerEntity } from './entities/banner.entity';
import { NotificationReadEntity } from './entities/notification-read.entity';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationOutboxEntity } from './outbox/notification-outbox.entity';
import { NotificationOutboxRegistry } from './outbox/notification-outbox.registry';
import { NotificationOutboxService } from './outbox/notification-outbox.service';

@Module({
  imports: [
    UserModule,
    TypeOrmModule.forFeature([
      BannerEntity,
      NotificationEntity,
      NotificationReadEntity,
      NotificationOutboxEntity,
    ]),
  ],
  controllers: [NotificationController, AppStateController],
  providers: [
    NotificationService,
    NotificationOutboxRegistry,
    NotificationOutboxService,
  ],
  exports: [NotificationService, NotificationOutboxRegistry],
})
export class NotificationModule {}
