import { Module } from '@nestjs/common';
import { StorytimeImagesModule } from '../images/storytime-images.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '../../notification/notification.module';
import { StorytimeArcsModule } from '../arcs/storytime-arcs.module';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { AdminStorytimeSpotlightController } from './admin-storytime-spotlight.controller';
import { StorytimeSpotlightEntity } from './entities/storytime-spotlight.entity';
import { PublicStorytimeSpotlightController } from './public-storytime-spotlight.controller';
import { StorytimeSpotlightMapper } from './storytime-spotlight.mapper';
import { StorytimeSpotlightService } from './storytime-spotlight.service';

/**
 * The Storytime Spotlight: editorial selections of Stories and Arcs.
 *
 * Imports Stories and Arcs and is imported by neither. The Spotlight has to
 * know what it is featuring; a Story has no business knowing whether it has
 * been chosen, and keeping it that way means the Spotlight can be switched off
 * entirely without anything else noticing.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StorytimeSpotlightEntity]),
    StorytimeStoriesModule,
    StorytimeArcsModule,
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
