import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '../../notification/notification.module';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { AdminStorytimeModerationController } from './admin-storytime-moderation.controller';
import { StorytimeModerationActionEntity } from './entities/storytime-moderation-action.entity';
import { StorytimeModerationAppealEntity } from './entities/storytime-moderation-appeal.entity';
import { StorytimeReportEntity } from './entities/storytime-report.entity';
import { StorytimeAppealService } from './storytime-appeal.service';
import { StorytimeModerationController } from './storytime-moderation.controller';
import { StorytimeModerationMapper } from './storytime-moderation.mapper';
import { StorytimeModerationService } from './storytime-moderation.service';
import { StorytimeModerationTargetService } from './storytime-moderation-target.service';
import { StorytimeReportService } from './storytime-report.service';

/**
 * Reports, removals, appeals and the audit trail behind them.
 *
 * Registers the four content entities directly rather than importing their
 * modules. Those modules exist to enforce ownership and collaboration, which
 * is precisely what an administrator is not subject to — and importing Stories
 * here while Stories imports nothing of moderation keeps the dependency
 * one-way.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeReportEntity,
      StorytimeModerationActionEntity,
      StorytimeModerationAppealEntity,
      StorytimeStoryEntity,
      StorytimeChapterEntity,
      StorytimeCharacterEntity,
      StorytimeArcEntity,
    ]),
    NotificationModule,
  ],
  controllers: [
    StorytimeModerationController,
    AdminStorytimeModerationController,
  ],
  providers: [
    StorytimeModerationTargetService,
    StorytimeModerationService,
    StorytimeReportService,
    StorytimeAppealService,
    StorytimeModerationMapper,
  ],
  exports: [
    StorytimeModerationService,
    StorytimeReportService,
    StorytimeAppealService,
  ],
})
export class StorytimeModerationModule {}
