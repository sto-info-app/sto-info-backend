import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from '../../notification/notification.module';
import { StorytimeArcsModule } from '../arcs/storytime-arcs.module';
import { StorytimeImagesModule } from '../images/storytime-images.module';
import { StorytimeAuthorModule } from '../shared/storytime-author.module';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeTagsModule } from '../tags/storytime-tags.module';
import { AdminStorytimeSpotlightController } from './admin-storytime-spotlight.controller';
import { StorytimeSpotlightEntity } from './entities/storytime-spotlight.entity';
import { PublicStorytimeSpotlightController } from './public-storytime-spotlight.controller';
import { StorytimeSpotlightMapper } from './storytime-spotlight.mapper';
import { StorytimeSpotlightService } from './storytime-spotlight.service';

/**
 * The Storytime Spotlight: editorial selections of Stories and Arcs.
 *
 * Imports Stories, Arcs and their tags, and is imported by none of them. The
 * Spotlight has to know what it is featuring; a Story has no business knowing
 * whether it has been chosen, and keeping it that way means the Spotlight can
 * be switched off entirely without anything else noticing.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StorytimeSpotlightEntity]),
    StorytimeStoriesModule,
    StorytimeArcsModule,
    StorytimeAuthorModule,
    StorytimeTagsModule,
    StorytimeImagesModule,
    NotificationModule,
  ],
  controllers: [
    PublicStorytimeSpotlightController,
    AdminStorytimeSpotlightController,
  ],
  providers: [
    StorytimeSpotlightService,
    StorytimeSpotlightMapper,
    StorytimeFeatureService,
  ],
  exports: [StorytimeSpotlightService, StorytimeSpotlightMapper],
})
export class StorytimeSpotlightModule {}
