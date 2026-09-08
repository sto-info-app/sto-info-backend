import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { StorytimeStoryArcsService } from './storytime-story-arcs.service';

/**
 * Naming the Arcs a Story is read as part of.
 *
 * A module of its own, holding the two Arc tables and nothing else, for the
 * same reason the author lookup has one: Arcs already depend on Stories, so a
 * Story reaching back through the Arc module for a line under its title would
 * close a circle. This depends only on what it reads.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StorytimeArcEntity, StorytimeArcStoryEntity]),
  ],
  providers: [StorytimeStoryArcsService],
  exports: [StorytimeStoryArcsService],
})
export class StorytimeStoryArcsModule {}
