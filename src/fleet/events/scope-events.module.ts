import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from 'src/notification/notification.module';

import { FleetModule } from '../fleet.module';
import { ScopeEventActionEntity } from './entities/scope-event-action.entity';
import { ScopeEventAttendanceEntity } from './entities/scope-event-attendance.entity';
import { ScopeEventAudienceMemberEntity } from './entities/scope-event-audience-member.entity';
import { ScopeEventOccurrenceEntity } from './entities/scope-event-occurrence.entity';
import { ScopeEventReminderEntity } from './entities/scope-event-reminder.entity';
import { ScopeEventRsvpEntity } from './entities/scope-event-rsvp.entity';
import { ScopeEventEntity } from './entities/scope-event.entity';
import {
  ArmadaEventsController,
  CommunityEventsController,
  FleetEventsController,
  PersonalEventsController,
} from './scope-events.controllers';
import { ScopeEventAccessService } from './services/scope-event-access.service';
import { ScopeEventAttendanceService } from './services/scope-event-attendance.service';
import { ScopeEventReadService } from './services/scope-event-read.service';
import { ScopeEventReminderService } from './services/scope-event-reminder.service';
import { ScopeEventRsvpService } from './services/scope-event-rsvp.service';
import { ScopeEventService } from './services/scope-event.service';

/**
 * A Community's, a Fleet's and an Armada's events (FC-028): their rules and
 * occurrences, answers and the waitlist, attendance, and reminders.
 */
@Module({
  imports: [
    FleetModule,
    NotificationModule,
    TypeOrmModule.forFeature([
      ScopeEventEntity,
      ScopeEventAudienceMemberEntity,
      ScopeEventOccurrenceEntity,
      ScopeEventRsvpEntity,
      ScopeEventAttendanceEntity,
      ScopeEventReminderEntity,
      ScopeEventActionEntity,
    ]),
  ],
  controllers: [
    CommunityEventsController,
    FleetEventsController,
    ArmadaEventsController,
    PersonalEventsController,
  ],
  providers: [
    ScopeEventAccessService,
    ScopeEventService,
    ScopeEventReadService,
    ScopeEventRsvpService,
    ScopeEventAttendanceService,
    ScopeEventReminderService,
  ],
  exports: [ScopeEventAccessService],
})
export class ScopeEventsModule {}
