import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorytimeArcTagEntity } from './entities/storytime-arc-tag.entity';
import { StorytimeCharacterTagEntity } from './entities/storytime-character-tag.entity';
import { StorytimeStoryTagEntity } from './entities/storytime-story-tag.entity';
import { StorytimeTagEntity } from './entities/storytime-tag.entity';
import { StorytimeTagMapper } from './storytime-tag.mapper';
import { StorytimeTagService } from './storytime-tag.service';
import { StorytimeTaggingService } from './storytime-tagging.service';

/**
 * Reading and writing tags, with no opinion about what is tagged.
 *
 * Split out from the module that owns the tag routes so that Stories and Arcs
 * can say what they are tagged with. The routes have to ask a Story who may
 * edit it, which makes the tag module depend on Stories; a listing of Stories
 * that names its tags would then have made the two depend on each other. This
 * module depends on nothing but its own tables, so anything may read from it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeTagEntity,
      StorytimeStoryTagEntity,
      StorytimeArcTagEntity,
      StorytimeCharacterTagEntity,
    ]),
  ],
  providers: [StorytimeTagService, StorytimeTaggingService, StorytimeTagMapper],
  exports: [StorytimeTagService, StorytimeTaggingService, StorytimeTagMapper],
})
export class StorytimeTaggingModule {}
