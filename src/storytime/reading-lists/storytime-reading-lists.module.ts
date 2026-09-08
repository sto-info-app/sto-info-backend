import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorytimeArcsModule } from '../arcs/storytime-arcs.module';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeReadingListItemEntity } from './entities/storytime-reading-list-item.entity';
import { StorytimeReadingListEntity } from './entities/storytime-reading-list.entity';
import { PublicStorytimeReadingListsController } from './public-storytime-reading-lists.controller';
import { StorytimeReadingListMapper } from './storytime-reading-list.mapper';
import { StorytimeReadingListService } from './storytime-reading-list.service';
import { StorytimeReadingListsController } from './storytime-reading-lists.controller';

/**
 * Reading lists: things a member has gathered, in the order they mean them.
 *
 * Imports the Stories and Arcs modules rather than registering their entities,
 * because "something anybody may read" is exactly the rule those services own.
 * Repeating the filter here would let the two drift, and a list showing work
 * its author has since made private is the kind of drift that matters.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeReadingListEntity,
      StorytimeReadingListItemEntity,
    ]),
    StorytimeStoriesModule,
    StorytimeArcsModule,
  ],
  controllers: [
    StorytimeReadingListsController,
    PublicStorytimeReadingListsController,
  ],
  providers: [
    StorytimeReadingListService,
    StorytimeReadingListMapper,
    StorytimeFeatureService,
  ],
  exports: [StorytimeReadingListService],
})
export class StorytimeReadingListsModule {}
