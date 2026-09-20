import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AssetIngressModule } from 'src/file-assets/asset-ingress.module';
import { SharedModule } from 'src/shared/shared.module';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { StorytimeSpotlightEntity } from '../spotlight/entities/storytime-spotlight.entity';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeArcImagePublisher } from './storytime-arc-image.publisher';
import { StorytimeCastImagePublisher } from './storytime-cast-image.publisher';
import { StorytimeChapterImagePublisher } from './storytime-chapter-image.publisher';
import { StorytimeImageService } from './storytime-image.service';
import { StorytimeSpotlightImagePublisher } from './storytime-spotlight-image.publisher';
import { StorytimeStoryImagePublisher } from './storytime-story-image.publisher';

/**
 * Storytime's artwork handling.
 *
 * Deliberately one module rather than a service per area. Every slot is
 * checked, quarantined, scanned and published the same way, and the
 * differences between a Story banner and a Character portrait are data in
 * the slot table rather than code — so five copies of this would be five
 * places for the rules to drift.
 *
 * The five publishers live here for the same reason, and not in the modules
 * that own their tables. What they do is one paragraph each and it is the
 * same paragraph: set the picture, set its description, bump the version,
 * report what was there before. Keeping them together is what makes it
 * obvious when one of them stops matching the others.
 */
@Module({
  imports: [
    SharedModule,
    AssetIngressModule,
    TypeOrmModule.forFeature([
      StorytimeArcEntity,
      StorytimeStoryEntity,
      StorytimeChapterEntity,
      StorytimeCharacterEntity,
      StorytimeSpotlightEntity,
    ]),
  ],
  providers: [
    StorytimeImageService,
    StorytimeArcImagePublisher,
    StorytimeStoryImagePublisher,
    StorytimeChapterImagePublisher,
    StorytimeCastImagePublisher,
    StorytimeSpotlightImagePublisher,
  ],
  exports: [StorytimeImageService],
})
export class StorytimeImagesModule {}
