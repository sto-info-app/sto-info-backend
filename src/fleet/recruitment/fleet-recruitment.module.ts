import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { FactionEntity } from 'src/sto/character/entities/faction.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { FleetModule } from '../fleet.module';
import { RosterIdentityAliasEntity } from '../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../imports/entities/roster-observation.entity';
import { CharacterFleetMapper } from '../mappers/character-fleet.mapper';
import { RosterEpisodeEntity } from '../projection/entities/roster-episode.entity';
import { FleetRosterModule } from '../roster/fleet-roster.module';
import { FleetApplicationActionEntity } from './entities/fleet-application-action.entity';
import { FleetApplicationEntity } from './entities/fleet-application.entity';
import { FleetInvitationEntity } from './entities/fleet-invitation.entity';
import { FleetRecruitmentSettingsEntity } from './entities/fleet-recruitment-settings.entity';
import { ScopeMembershipActionEntity } from './entities/scope-membership-action.entity';
import { FleetRecruitmentController } from './fleet-recruitment.controller';
import { MyFleetRecruitmentController } from './my-fleet-recruitment.controller';
import { ApplicationEvidenceService } from './services/application-evidence.service';
import { FleetApplicationService } from './services/fleet-application.service';
import { FleetInvitationService } from './services/fleet-invitation.service';
import { FleetRecruitmentViewService } from './services/fleet-recruitment-view.service';
import { RecruitmentEligibilityService } from './services/recruitment-eligibility.service';
import { RecruitmentMembershipService } from './services/recruitment-membership.service';
import { RecruitmentSettingsService } from './services/recruitment-settings.service';

/**
 * How people come into a Fleet and leave it (FC-021).
 *
 * Above the Fleet domain and the roster: it grants the memberships the
 * domain's authorisation reads, and reads the roster only to show a decider
 * its evidence. Nothing below it needs anything of it.
 */
@Module({
  imports: [
    FleetModule,
    FleetRosterModule,
    TypeOrmModule.forFeature([
      FleetRecruitmentSettingsEntity,
      FleetApplicationEntity,
      FleetApplicationActionEntity,
      FleetInvitationEntity,
      ScopeMembershipActionEntity,
      RosterIdentityAliasEntity,
      RosterEpisodeEntity,
      RosterObservationEntity,
      AccountEntity,
      CharacterEntity,
      FactionEntity,
      UserProfileEntity,
    ]),
  ],
  controllers: [FleetRecruitmentController, MyFleetRecruitmentController],
  providers: [
    ApplicationEvidenceService,
    CharacterFleetMapper,
    FleetApplicationService,
    FleetInvitationService,
    FleetRecruitmentViewService,
    RecruitmentEligibilityService,
    RecruitmentMembershipService,
    RecruitmentSettingsService,
  ],
})
export class FleetRecruitmentModule {}
