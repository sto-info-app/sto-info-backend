import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from '../../notification/notification.module';
import { UserProfileEntity } from '../../user/entities/user-profile.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { StorytimeCollaborationModule } from '../collaboration/storytime-collaboration.module';
import { StorytimeStoriesModule } from '../stories/storytime-stories.module';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeCrewCreditEntity } from './entities/storytime-crew-credit.entity';
import { StorytimeCrewRoleEntity } from './entities/storytime-crew-role.entity';
import { StorytimeStoryCollaboratorEntity } from './entities/storytime-story-collaborator.entity';
import { PublicStorytimeCrewController } from './public-storytime-crew.controller';
import { StorytimeCollaboratorService } from './storytime-collaborator.service';
import { StorytimeCreditableMemberService } from './storytime-creditable-member.service';
import { StorytimeCrewCreditService } from './storytime-crew-credit.service';
import { StorytimeCrewController } from './storytime-crew.controller';
import { StorytimeCrewMapper } from './storytime-crew.mapper';

/**
 * Collaboration and credits.
 *
 * Sits above both Stories and the collaboration module: managing invitations
 * needs the Story, to check who is allowed to send one, while the capability
 * lookup those invitations produce is consulted by Stories itself. Splitting
 * the two is what keeps that from being a cycle.
 *
 * The Chapter and Character repositories are registered here so a credit can
 * be checked against the Story it claims to belong to, and the member profile
 * repository so a credit can name somebody by the username they display rather
 * than by an identifier the rest of the application refuses to hand out.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeStoryCollaboratorEntity,
      StorytimeCrewRoleEntity,
      StorytimeCrewCreditEntity,
      StorytimeChapterEntity,
      StorytimeCharacterEntity,
      UserProfileEntity,
    ]),
    StorytimeStoriesModule,
    StorytimeCollaborationModule,
    NotificationModule,
  ],
  controllers: [PublicStorytimeCrewController, StorytimeCrewController],
  providers: [
    StorytimeCollaboratorService,
    StorytimeCreditableMemberService,
    StorytimeCrewCreditService,
    StorytimeCrewMapper,
    StorytimeFeatureService,
  ],
  exports: [
    StorytimeCollaboratorService,
    StorytimeCreditableMemberService,
    StorytimeCrewCreditService,
    StorytimeCrewMapper,
  ],
})
export class StorytimeCrewModule {}
