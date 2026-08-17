import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeArcsModule } from '../arcs/storytime-arcs.module';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { PublicStorytimeCreatorsController } from './public-storytime-creators.controller';
import { PublicStorytimeSearchController } from './public-storytime-search.controller';
import { StorytimeSearchService } from './storytime-search.service';

/**
 * Searching published Storytime content.
 *
 * Search registers the four content entities directly rather than importing
 * their modules: it reads the vectors the database maintains and needs no rule
 * any of those services enforce.
 *
 * The creator page is the exception. It shows what somebody has published, and
 * "published" is exactly the rule the Story and Arc services own, so it asks
 * them rather than repeating the filter here and letting the two drift.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeStoryEntity,
      StorytimeChapterEntity,
      StorytimeCharacterEntity,
      StorytimeArcEntity,
    ]),
    StorytimeStoriesModule,
    StorytimeArcsModule,
  ],
  controllers: [
    PublicStorytimeSearchController,
    PublicStorytimeCreatorsController,
  ],
  providers: [StorytimeSearchService, StorytimeFeatureService],
  exports: [StorytimeSearchService],
})
export class StorytimeSearchModule {}
