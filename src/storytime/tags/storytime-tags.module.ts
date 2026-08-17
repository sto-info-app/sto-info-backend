import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorytimeArcsModule } from '../arcs/storytime-arcs.module';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeArcTagEntity } from './entities/storytime-arc-tag.entity';
import { StorytimeCharacterTagEntity } from './entities/storytime-character-tag.entity';
import { StorytimeStoryTagEntity } from './entities/storytime-story-tag.entity';
import { StorytimeTagEntity } from './entities/storytime-tag.entity';
import { StorytimeTagMapper } from './storytime-tag.mapper';
import { StorytimeTagService } from './storytime-tag.service';
import { StorytimeTaggingService } from './storytime-tagging.service';
import { StorytimeTagsController } from './storytime-tags.controller';

/**
 * The Storytime tag vocabulary, and the tags attached to content.
 *
 * Imports Stories and Arcs to ask them who may edit what. Tagging a Story is
 * editing it, so the rule about who may do that belongs where the rest of that
 * rule already lives rather than being restated here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeTagEntity,
      StorytimeStoryTagEntity,
      StorytimeArcTagEntity,
      StorytimeCharacterTagEntity,
    ]),
    StorytimeStoriesModule,
    StorytimeArcsModule,
  ],
  controllers: [StorytimeTagsController],
  providers: [StorytimeTagService, StorytimeTaggingService, StorytimeTagMapper],
  exports: [StorytimeTagService, StorytimeTaggingService, StorytimeTagMapper],
})
export class StorytimeTagsModule {}
