import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from '../../notification/notification.module';
import { StorytimeCollaborationModule } from '../collaboration/storytime-collaboration.module';
import { StorytimeContentModule } from '../content/storytime-content.module';
import { StorytimeImagesModule } from '../images/storytime-images.module';
import { StorytimeProgressModule } from '../progress/storytime-progress.module';
import { StorytimeSocialModule } from '../social/storytime-social.module';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeTaggingModule } from '../tags/storytime-tagging.module';
import { StorytimeArcCollaboratorEntity } from './entities/storytime-arc-collaborator.entity';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { PublicStorytimeArcsController } from './public-storytime-arcs.controller';
import { StorytimeArcCollaboratorService } from './storytime-arc-collaborator.service';
import { StorytimeArcCollaboratorsController } from './storytime-arc-collaborators.controller';
import { StorytimeArcMembershipPresenter } from './storytime-arc-membership.presenter';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
import { StorytimeArcMembershipsController } from './storytime-arc-memberships.controller';
import { StorytimeArcProgressService } from './storytime-arc-progress.service';
import { StorytimeArcMapper } from './storytime-arc.mapper';
import { StorytimeArcService } from './storytime-arc.service';
import { StorytimeCreatorArcsController } from './storytime-creator-arcs.controller';

/**
 * Arcs: reading orders curated across several Stories.
 *
 * Imports Stories rather than the other way round. An Arc needs to know who
 * owns a Story to settle whether it may join, while a Story knows nothing
 * about Arcs — so a Story can be written, published and read by somebody who
 * has never heard of one.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeArcEntity,
      StorytimeArcStoryEntity,
      StorytimeArcCollaboratorEntity,
    ]),
    StorytimeStoriesModule,
    StorytimeContentModule,
    StorytimeCollaborationModule,
    StorytimeImagesModule,
    StorytimeProgressModule,
    NotificationModule,
    StorytimeSocialModule,

    // An Arc listing says what each Arc is about. Only the tables, not the
    // routes that set tags: those ask an Arc who may edit it, and importing
    // them here would close the circle.
    StorytimeTaggingModule,
  ],
  controllers: [
    PublicStorytimeArcsController,
    StorytimeCreatorArcsController,
    StorytimeArcMembershipsController,
    StorytimeArcCollaboratorsController,
  ],
  providers: [
    StorytimeArcService,
    StorytimeArcMembershipService,
    StorytimeArcMembershipPresenter,
    StorytimeArcCollaboratorService,
    StorytimeArcProgressService,
    StorytimeArcMapper,
    StorytimeFeatureService,
  ],
  exports: [
    StorytimeArcService,
    StorytimeArcMembershipService,
    StorytimeArcMapper,
  ],
})
export class StorytimeArcsModule {}
