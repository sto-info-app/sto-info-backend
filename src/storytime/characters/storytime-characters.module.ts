import { Module } from '@nestjs/common';
import { StorytimeImagesModule } from '../images/storytime-images.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorytimeChaptersModule } from '../chapters/storytime-chapters.module';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeContentModule } from '../content/storytime-content.module';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeChapterCharacterEntity } from './entities/storytime-chapter-character.entity';
import { StorytimeCharacterEntity } from './entities/storytime-character.entity';
import { PublicStorytimeCharactersController } from './public-storytime-characters.controller';
import { StorytimeAppearanceService } from './storytime-appearance.service';
import { StorytimeCharacterMapper } from './storytime-character.mapper';
import { StorytimeCharacterService } from './storytime-character.service';
import { StorytimeCreatorCharactersController } from './storytime-creator-characters.controller';

/**
 * Characters: the cast of a Story, and who appears where.
 *
 * Imports the Stories module rather than reimplementing ownership, so a caller
 * may act on a Character exactly when they may act on its Story.
 *
 * The Chapter repository is registered here so appearances can check that a
 * Chapter and a Character share a Story; the Chapters module is imported for
 * the readable-Chapter list a Character's page links to. The dependency runs
 * one way — Chapters know nothing about Characters — so a Story can be written
 * with no cast at all and nothing notices.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeCharacterEntity,
      StorytimeChapterCharacterEntity,
      StorytimeChapterEntity,
    ]),
    StorytimeStoriesModule,
    StorytimeChaptersModule,
    StorytimeContentModule,
    StorytimeImagesModule,
  ],
  controllers: [
    PublicStorytimeCharactersController,
    StorytimeCreatorCharactersController,
  ],
  providers: [
    StorytimeCharacterService,
    StorytimeAppearanceService,
    StorytimeCharacterMapper,
    StorytimeFeatureService,
  ],
  exports: [
    StorytimeCharacterService,
    StorytimeAppearanceService,
    StorytimeCharacterMapper,
  ],
})
export class StorytimeCharactersModule {}
