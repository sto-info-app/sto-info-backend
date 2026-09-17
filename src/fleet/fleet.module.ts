import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArmadaFleetMembershipEntity } from './entities/armada-fleet-membership.entity';
import { CharacterFleetMembershipEntity } from './entities/character-fleet-membership.entity';
import { CommunitySubscriptionEntity } from './entities/community-subscription.entity';
import { FleetCommunityEntity } from './entities/fleet-community.entity';
import { FleetNameAliasEntity } from './entities/fleet-name-alias.entity';
import { ScopeMembershipEntity } from './entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from './entities/scope-role-assignment.entity';
import { StoArmadaEntity } from './entities/sto-armada.entity';
import { StoFleetEntity } from './entities/sto-fleet.entity';

/**
 * Fleet Community — Communities, Fleets, Armadas and the records that relate
 * users and Characters to them.
 *
 * Not to be confused with `CommunityModule`, which is the personal social graph
 * of friendships and blocks. ADR-0008 fixes the boundary: this module may
 * depend on that one, never the reverse.
 *
 * At FC-004 the module registers the domain schema and nothing else — there are
 * no services or controllers yet, and no route is served. Registering it now
 * means the migration and the entities are exercised by application start-up
 * rather than by the next ticket discovering they disagree.
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
      CharacterFleetMembershipEntity,
    ]),
  ],
})
export class FleetModule {}
