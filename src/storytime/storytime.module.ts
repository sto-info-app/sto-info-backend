import { Module } from '@nestjs/common';
import { AdminStorytimeConfigurationController } from './admin-storytime-configuration.controller';
import { StorytimeChaptersModule } from './chapters/storytime-chapters.module';
import { StorytimeCrewModule } from './crew/storytime-crew.module';
import { StorytimeCharactersModule } from './characters/storytime-characters.module';
import { StorytimeContentModule } from './content/storytime-content.module';
import { StorytimeProgressModule } from './progress/storytime-progress.module';
import { StorytimeConfigurationController } from './storytime-configuration.controller';
import { StorytimeFeatureService } from './storytime-feature.service';
import { StorytimeStoriesModule } from './stories/storytime-stories.module';

/**
 * STO Storytime — community fan-fiction publishing.
 *
 * This is the feature's root module. It currently owns only the feature
 * switches and the client configuration they drive; Stories, Chapters,
 * Characters, Crew, Arcs, media, progress, social features, the Spotlight,
 * search and moderation arrive as their own submodules.
 *
 * `StorytimeFeatureService` is exported because every submodule has to be able
 * to check whether the capability it implements is switched on before acting.
 */
@Module({
  imports: [
    StorytimeContentModule,
    StorytimeStoriesModule,
    StorytimeChaptersModule,
    StorytimeCharactersModule,
    StorytimeCrewModule,
    StorytimeProgressModule,
  ],
  controllers: [
    StorytimeConfigurationController,
    AdminStorytimeConfigurationController,
  ],
  providers: [StorytimeFeatureService],
  exports: [
    StorytimeFeatureService,
    StorytimeContentModule,
    StorytimeStoriesModule,
    StorytimeChaptersModule,
    StorytimeCharactersModule,
    StorytimeCrewModule,
    StorytimeProgressModule,
  ],
})
export class StorytimeModule {}
