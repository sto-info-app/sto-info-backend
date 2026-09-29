import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from 'src/notification/notification.module';

import { ScopeEventsModule } from '../events/scope-events.module';
import { FleetModule } from '../fleet.module';
import {
  ArmadaActivityController,
  CommunityActivityController,
  FleetActivityController,
  PersonalActivityController,
} from './activity.controllers';
import { ActivityEventEntity } from './entities/activity-event.entity';
import { ActivityFeedService } from './services/activity-feed.service';
import { ActivitySentenceWriter } from './services/activity-sentence.writer';
import { ProposalNoticeHandler } from './services/proposal-notice.handler';

/**
 * Activity feeds for Communities, Fleets and Armadas, and each person's own
 * (FC-029). Features record activity with `recordActivity` in their own
 * transactions; this module only reads it. It also writes the one targeted
 * notice FC-029 adds, a Fleet asking about somebody's Character.
 */
@Module({
  imports: [
    FleetModule,
    NotificationModule,
    ScopeEventsModule,
    TypeOrmModule.forFeature([ActivityEventEntity]),
  ],
  controllers: [
    CommunityActivityController,
    FleetActivityController,
    ArmadaActivityController,
    PersonalActivityController,
  ],
  providers: [
    ActivityFeedService,
    ActivitySentenceWriter,
    ProposalNoticeHandler,
  ],
  exports: [ActivityFeedService],
})
export class ActivityModule {}
