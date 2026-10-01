import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { S3Client } from '@aws-sdk/client-s3';
import Redis from 'ioredis';

import { AuthModule } from 'src/auth/auth.module';
import { CommunityModule } from 'src/community/community.module';
import { FileAssetsModule } from 'src/file-assets/file-assets.module';
import { NotificationModule } from 'src/notification/notification.module';
import { QueueModule } from 'src/shared/queue/queue.module';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { SharedModule } from 'src/shared/shared.module';

import { FleetModule } from '../fleet.module';
import {
  ChatReportAdminController,
  ChatSafetyController,
} from './chat-safety.controllers';
import {
  ArmadaChatController,
  ChatController,
  CommunityChatController,
  FleetChatController,
} from './chat.controllers';
import { ChatActionEntity } from './entities/chat-action.entity';
import { ChatChannelEntity } from './entities/chat-channel.entity';
import { ChatDirectConversationEntity } from './entities/chat-direct-conversation.entity';
import { ChatMessageReportEntity } from './entities/chat-message-report.entity';
import { ChatMessageEntity } from './entities/chat-message.entity';
import { ChatReportEvidenceEntity } from './entities/chat-report-evidence.entity';
import { ChatTranscriptEntity } from './entities/chat-transcript.entity';
import { HoldLedgerReconciliationService } from './holds/hold-ledger-reconciliation.service';
import { HoldLedgerService } from './holds/hold-ledger.service';
import { ModerationHoldActionEntity } from './holds/moderation-hold-action.entity';
import { ModerationHoldEntity } from './holds/moderation-hold.entity';
import { ModerationHoldService } from './holds/moderation-hold.service';
import { ModerationHoldsController } from './holds/moderation-holds.controller';
import { ChatAccessWatcher } from './realtime/chat-access-watcher';
import { ChatDeliveryService } from './realtime/chat-delivery.service';
import { ChatNoticeHandler } from './realtime/chat-notice.handler';
import {
  CHAT_REDIS,
  ChatPresenceService,
} from './realtime/chat-presence.service';
import { ChatSocketAuthService } from './realtime/chat-socket-auth.service';
import { ChatGateway } from './realtime/chat.gateway';
import { ChatReportService } from './reporting/chat-report.service';
import { ChatAccessService } from './services/chat-access.service';
import { ChatChannelService } from './services/chat-channel.service';
import { ChatDirectService } from './services/chat-direct.service';
import { ChatMessageService } from './services/chat-message.service';
import {
  CHAT_EXPORTS_S3_CLIENT,
  ChatExportStorageService,
} from './transcripts/chat-export-storage.service';
import { CHAT_TRANSCRIPT_QUEUE } from './transcripts/chat-transcript.constants';
import { ChatTranscriptProcessor } from './transcripts/chat-transcript.processor';
import { ChatTranscriptService } from './transcripts/chat-transcript.service';

/**
 * Chat for Communities, Fleets and Armadas, and between friends (FC-031),
 * its socket (FC-032), its notices (FC-033), blocks, presence and typing
 * (FC-034), transcripts and reports (FC-035), and site admins' holds on
 * its evidence (FC-036), kept in the hold ledger too (FC-042).
 *
 * The exports bucket gets its own `S3Client` under its own token, built from
 * its own credentials, as the quarantine bucket does: the key that publishes
 * to the public bucket cannot read transcripts, and this one cannot publish.
 */
@Module({
  imports: [
    AuthModule,
    FleetModule,
    CommunityModule,
    FileAssetsModule,
    NotificationModule,
    SharedModule,
    QueueModule,
    BullModule.registerQueue({ name: CHAT_TRANSCRIPT_QUEUE }),
    TypeOrmModule.forFeature([
      ChatChannelEntity,
      ChatDirectConversationEntity,
      ChatMessageEntity,
      ChatActionEntity,
      ChatTranscriptEntity,
      ChatMessageReportEntity,
      ChatReportEvidenceEntity,
      ModerationHoldEntity,
      ModerationHoldActionEntity,
    ]),
  ],
  controllers: [
    CommunityChatController,
    FleetChatController,
    ArmadaChatController,
    ChatController,
    ChatSafetyController,
    ChatReportAdminController,
    ModerationHoldsController,
  ],
  providers: [
    ChatAccessService,
    ChatChannelService,
    ChatDirectService,
    ChatMessageService,
    ChatSocketAuthService,
    ChatDeliveryService,
    ChatGateway,
    ChatNoticeHandler,
    ChatPresenceService,
    ChatAccessWatcher,
    {
      // Presence's own connection: one more an instance (FC-034).
      provide: CHAT_REDIS,
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') as string),
      inject: [ConfigService],
    },
    ChatExportStorageService,
    ChatTranscriptService,
    ChatTranscriptProcessor,
    ChatReportService,
    ModerationHoldService,
    HoldLedgerService,
    HoldLedgerReconciliationService,
    {
      provide: CHAT_EXPORTS_S3_CLIENT,
      useFactory: async (
        configService: ConfigService,
        secretsService: SecretsService,
      ) => {
        const secretName = configService.get<string>('AWS_SECRET_NAME')!;
        const secretObject = await secretsService.getSecret(secretName);

        return new S3Client({
          region: 'auto',
          endpoint: configService.get<string>('CLOUDFLARE_R2_ENDPOINT')!,
          credentials: {
            accessKeyId: secretObject.cloudflareR2ExportsAccessKey,
            secretAccessKey: secretObject.cloudflareR2ExportsSecret,
          },
        });
      },
      inject: [ConfigService, SecretsService],
    },
  ],
  exports: [
    ChatAccessService,
    ChatChannelService,
    ChatDirectService,
    ChatMessageService,
    ChatDeliveryService,
    ChatReportService,
    ChatTranscriptService,
    ModerationHoldService,
    HoldLedgerReconciliationService,
  ],
})
export class ChatModule {}
