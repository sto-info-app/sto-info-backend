import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from '../../shared/shared.module';
import { SesEventEntity } from './entities/ses-event.entity';
import { SesWebhookController } from './ses-webhook.controller';
import { SesWebhookService } from './ses-webhook.service';

@Module({
  imports: [TypeOrmModule.forFeature([SesEventEntity]), SharedModule],
  controllers: [SesWebhookController],
  providers: [SesWebhookService],
  exports: [SesWebhookService],
})
export class SesWebhookModule {}
