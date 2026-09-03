import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeUserChapterProgressEntity } from './entities/storytime-user-chapter-progress.entity';
import { StorytimeUserStoryProgressEntity } from './entities/storytime-user-story-progress.entity';
import { StorytimeProgressController } from './storytime-progress.controller';
import { StorytimeProgressMapper } from './storytime-progress.mapper';
import { StorytimeProgressService } from './storytime-progress.service';

/**
 * Reader progress through Stories and Chapters.
 *
 * Reads the Chapter table directly rather than importing the Chapters module,
 * to keep the dependency running one way: Chapters tell progress that content
 * has been published, and progress does not reach back into Chapter
 * management.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeUserStoryProgressEntity,
      StorytimeUserChapterProgressEntity,
      StorytimeChapterEntity,
    ]),
    StorytimeStoriesModule,
  ],
  controllers: [StorytimeProgressController],
  providers: [
    StorytimeProgressService,
    StorytimeProgressMapper,
    StorytimeFeatureService,
  ],
  exports: [StorytimeProgressService],
})
export class StorytimeProgressModule {}
