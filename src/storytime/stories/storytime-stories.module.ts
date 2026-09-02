import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorytimeCollaborationModule } from '../collaboration/storytime-collaboration.module';
import { StorytimeContentModule } from '../content/storytime-content.module';
import { StorytimeImagesModule } from '../images/storytime-images.module';
import { StorytimeAuthorModule } from '../shared/storytime-author.module';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeSocialModule } from '../social/storytime-social.module';
import { StorytimeSlugService } from '../shared/storytime-slug.service';
import { StorytimeTaggingModule } from '../tags/storytime-tagging.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeSlugHistoryEntity } from './entities/storytime-slug-history.entity';
import { StorytimeStoryEntity } from './entities/storytime-story.entity';
import { PublicStorytimeStoriesController } from './public-storytime-stories.controller';
import { StorytimeCreatorStoriesController } from './storytime-creator-stories.controller';
import { StorytimeStoryMapper } from './storytime-story.mapper';
import { StorytimeStoryService } from './storytime-story.service';

/**
 * Stories: the container creators publish Chapters within.
 *
 * Owns the slug and ordering services rather than the Storytime root module,
 * because Stories are the first consumer of both. Chapters and Characters will
 * import this module for them rather than each declaring their own instance.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeStoryEntity,
      StorytimeSlugHistoryEntity,
    ]),
    StorytimeContentModule,
    StorytimeCollaborationModule,
    StorytimeImagesModule,
    StorytimeSocialModule,

    // A published work says who wrote it, and the member behind an owner ID
    // is the community's to resolve rather than Storytime's.
    StorytimeAuthorModule,

    // A listing says what each Story is about. The tables behind that are in
    // a module of their own precisely so this import does not run in a circle
    // through the routes that set tags, which have to ask Stories who may.
    StorytimeTaggingModule,
  ],
  controllers: [
    PublicStorytimeStoriesController,
    StorytimeCreatorStoriesController,
  ],
  providers: [
    StorytimeStoryService,
    StorytimeStoryMapper,
    StorytimeSlugService,
    StorytimeOrderingService,
    StorytimeFeatureService,
  ],
  exports: [
    StorytimeStoryService,
    StorytimeStoryMapper,
    StorytimeSlugService,
    StorytimeOrderingService,
    StorytimeAuthorModule,
  ],
})
export class StorytimeStoriesModule {}
