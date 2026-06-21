import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppStateController } from './app-state.controller';
import { BannerEntity } from './entities/banner.entity';
import { NotificationReadEntity } from './entities/notification-read.entity';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BannerEntity,
      NotificationEntity,
      NotificationReadEntity,
    ]),
  ],
  controllers: [NotificationController, AppStateController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
