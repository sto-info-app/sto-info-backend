import { Module } from '@nestjs/common';

import { StorytimeArcsModule } from '../arcs/storytime-arcs.module';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeTaggingModule } from './storytime-tagging.module';
import { StorytimeTagsController } from './storytime-tags.controller';

/**
 * The routes that read and change tags.
 *
 * Imports Stories and Arcs to ask them who may edit what. Tagging a Story is
 * editing it, so the rule about who may do that belongs where the rest of that
 * rule already lives rather than being restated here.
 *
 * The tag tables and the services over them live in StorytimeTaggingModule,
 * which is re-exported here so that anything already importing this module
 * keeps them. They are kept apart because Stories and Arcs read tags to list
 * them, and could not import a module that imports them back.
 */
@Module({
  imports: [
    StorytimeTaggingModule,
    StorytimeStoriesModule,
    StorytimeArcsModule,
  ],
  controllers: [StorytimeTagsController],
  exports: [StorytimeTaggingModule],
})
export class StorytimeTagsModule {}
