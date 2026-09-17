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
import { ScopeCapabilityGrantEntity } from './entities/scope-capability-grant.entity';
import { ScopeMembershipEntity } from './entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from './entities/scope-role-assignment.entity';
import { StoArmadaEntity } from './entities/sto-armada.entity';
import { StoFleetEntity } from './entities/sto-fleet.entity';

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
 * The module being loaded is not the same thing as the feature being on. The
 * runtime master switch lands in `app_setting` in FC-006, following the
 * existing `STORYTIME_ENABLED` pattern.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FleetCommunityEntity,
      StoFleetEntity,
      StoArmadaEntity,
      FleetNameAliasEntity,
      ArmadaFleetMembershipEntity,
      CommunitySubscriptionEntity,
      ScopeMembershipEntity,
      ScopeRoleAssignmentEntity,
      ScopeCapabilityGrantEntity,
      CharacterFleetMembershipEntity,
      UserEntity,
    ]),
  ],
  providers: [
    FleetAuthorisationService,
    FleetAudienceService,
    FleetAuthorisationRevisionService,
    ScopeCapabilityGuard,
  ],
  exports: [
    FleetAuthorisationService,
    FleetAudienceService,
    FleetAuthorisationRevisionService,
    ScopeCapabilityGuard,
  ],
})
export class FleetModule {}
