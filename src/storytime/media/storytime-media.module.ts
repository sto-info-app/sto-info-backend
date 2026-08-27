import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorytimeChaptersModule } from '../chapters/storytime-chapters.module';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeContentModule } from '../content/storytime-content.module';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeChapterMediaEntity } from './entities/storytime-chapter-media.entity';
import { PublicStorytimeMediaController } from './public-storytime-media.controller';
import { StorytimeMediaController } from './storytime-media.controller';
import { StorytimeMediaMapper } from './storytime-media.mapper';
import { StorytimeMediaService } from './storytime-media.service';

/**
 * The videos a Chapter embeds.
 *
 * Depends on Chapters rather than the other way round, so a Chapter renders
 * perfectly well knowing nothing about media — which is what lets embedding be
 * switched off centrally without touching the reader page.
 *
 * The content module is imported for the YouTube URL parser, which is the
 * security boundary here: a creator's URL is turned into an identifier and
 * nothing they typed is ever rendered.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeChapterMediaEntity,
      StorytimeChapterEntity,
    ]),
    StorytimeStoriesModule,
    StorytimeChaptersModule,
    StorytimeContentModule,
  ],
  controllers: [PublicStorytimeMediaController, StorytimeMediaController],
  providers: [
    StorytimeMediaService,
    StorytimeMediaMapper,
    StorytimeFeatureService,
  ],
  exports: [StorytimeMediaService, StorytimeMediaMapper],
})
export class StorytimeMediaModule {}
