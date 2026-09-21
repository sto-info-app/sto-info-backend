import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserEntity } from '../user/entities/user.entity';
import { FleetAudienceService } from './authorisation/fleet-audience.service';
import { FleetAuthorisationRevisionService } from './authorisation/fleet-authorisation-revision.service';
import { FleetAuthorisationService } from './authorisation/fleet-authorisation.service';
import { ScopeCapabilityGuard } from './authorisation/scope-capability.guard';
import { ArmadaFleetMembershipEntity } from './entities/armada-fleet-membership.entity';
import { CharacterFleetMembershipEntity } from './entities/character-fleet-membership.entity';
import { CommunitySubscriptionEntity } from './entities/community-subscription.entity';
import { FleetCommunityEntity } from './entities/fleet-community.entity';
import { FleetNameAliasEntity } from './entities/fleet-name-alias.entity';
import { FleetSlugHistoryEntity } from './entities/fleet-slug-history.entity';
import { ScopeCapabilityGrantEntity } from './entities/scope-capability-grant.entity';
import { ScopeMembershipEntity } from './entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from './entities/scope-role-assignment.entity';
import { StoArmadaEntity } from './entities/sto-armada.entity';
import { StoFleetEntity } from './entities/sto-fleet.entity';
import { FleetCommunitiesController } from './fleet-communities.controller';
import { FleetConfigurationController } from './fleet-configuration.controller';
import { FleetFeatureService } from './fleet-feature.service';
import { FleetPolicyService } from './fleet-policy.service';
import { FleetCommunityMapper } from './mappers/fleet-community.mapper';
import { FleetCommunityService } from './services/fleet-community.service';
import { FleetSlugService } from './services/fleet-slug.service';

/**
 * Fleet Community — Communities, Fleets, Armadas, the records that relate users
 * and Characters to them, and the authorisation policy over all of it.
 *
 * Not to be confused with `CommunityModule`, which is the personal social graph
 * of friendships and blocks. ADR-0008 fixes the boundary: this module may
 * depend on that one, never the reverse.
 *
 * The three authorisation services are exported because every later Fleet
 * ticket needs them and none of them should reimplement the decision. They are
 * *not* registered globally, unlike `AccessControlModule`: a scoped capability
 * is meaningless outside this feature, and making it reachable everywhere would
 * invite exactly the site-wide-permission-grants-all-Fleets confusion that
 * FC-005's first acceptance criterion exists to prevent.
 *
 * `UserEntity` is registered here for its own repository rather than borrowed
 * from the global access-control module, because `forFeature` registrations are
 * per-module even when the module declaring them is global.
 *
 * The module being loaded is not the same thing as the feature being on.
 * `FleetFeatureService` answers that, from the `FLEET_COMMUNITIES_ENABLED`
 * row seeded disabled in `app_setting`. Nothing to do with file scanning,
 * quarantine or retention consults it: those are site-wide and run whether
 * Fleet is switched on or not.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FleetCommunityEntity,
      StoFleetEntity,
      StoArmadaEntity,
      FleetNameAliasEntity,
      FleetSlugHistoryEntity,
      ArmadaFleetMembershipEntity,
      CommunitySubscriptionEntity,
      ScopeMembershipEntity,
      ScopeRoleAssignmentEntity,
      ScopeCapabilityGrantEntity,
      CharacterFleetMembershipEntity,
      UserEntity,
    ]),
  ],
  controllers: [FleetConfigurationController, FleetCommunitiesController],
  providers: [
    FleetFeatureService,
    FleetPolicyService,
    FleetSlugService,
    FleetCommunityService,
    FleetCommunityMapper,
    FleetAuthorisationService,
    FleetAudienceService,
    FleetAuthorisationRevisionService,
    ScopeCapabilityGuard,
  ],
  exports: [
    FleetFeatureService,
    FleetPolicyService,
    FleetSlugService,
    FleetCommunityService,
    FleetAuthorisationService,
    FleetAudienceService,
    FleetAuthorisationRevisionService,
    ScopeCapabilityGuard,
  ],
})
export class FleetModule {}
