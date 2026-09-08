import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorytimeContentModule } from '../content/storytime-content.module';
import { StorytimeImagesModule } from '../images/storytime-images.module';
import { StorytimeProgressModule } from '../progress/storytime-progress.module';
import { StorytimeAuthorModule } from '../shared/storytime-author.module';
import { StorytimeSocialModule } from '../social/storytime-social.module';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeChapterEntity } from './entities/storytime-chapter.entity';
import { PublicStorytimeChaptersController } from './public-storytime-chapters.controller';
import { StorytimeChapterSchedulerService } from './storytime-chapter-scheduler.service';
import { StorytimeChapterMapper } from './storytime-chapter.mapper';
import { StorytimeChapterService } from './storytime-chapter.service';
import { StorytimeCreatorChaptersController } from './storytime-creator-chapters.controller';

/**
 * Chapters: the ordered instalments within a Story.
 *
 * Imports the Stories module rather than reimplementing ownership, so a caller
 * may act on a Chapter exactly when they may act on its Story and the two can
 * never disagree.
 *
 * The Story repository is registered here as well, because publishing a
 * Chapter has to update its Story's published count in the same transaction.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StorytimeChapterEntity, StorytimeStoryEntity]),
    StorytimeStoriesModule,
    StorytimeAuthorModule,
    StorytimeContentModule,
    StorytimeImagesModule,
    StorytimeProgressModule,
    StorytimeSocialModule,
  ],
  controllers: [
    PublicStorytimeChaptersController,
    StorytimeCreatorChaptersController,
  ],
  providers: [
    StorytimeChapterService,
    StorytimeChapterMapper,
    StorytimeChapterSchedulerService,
    StorytimeFeatureService,
  ],
  exports: [StorytimeChapterService, StorytimeChapterMapper],
})
export class StorytimeChaptersModule {}
