import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from 'src/notification/notification.module';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { ScopeCapabilityGrantEntity } from '../entities/scope-capability-grant.entity';
import { ScopeMembershipEntity } from '../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../entities/scope-role-assignment.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetModule } from '../fleet.module';
import { AdminFleetGovernanceController } from './admin-fleet-governance.controller';
import { ArmadaGovernanceController } from './armada-governance.controller';
import { CommunityGovernanceController } from './community-governance.controller';
import { OwnershipTransferEntity } from './entities/ownership-transfer.entity';
import { ScopeGovernanceActionEntity } from './entities/scope-governance-action.entity';
import { FleetGovernanceController } from './fleet-governance.controller';
import { OwnershipTransferService } from './services/ownership-transfer.service';
import { ScopeClosureService } from './services/scope-closure.service';
import { ScopeGovernanceLogService } from './services/scope-governance-log.service';
import { ScopeRolesService } from './services/scope-roles.service';

/**
 * Who governs a Community or Fleet: roles, delegation, ownership and closure
 * (FC-022).
 *
 * Above the Fleet domain, whose authorisation reads the rows this writes.
 * Nothing below it needs anything of it.
 */
@Module({
  imports: [
    FleetModule,
    NotificationModule,
    TypeOrmModule.forFeature([
      ScopeGovernanceActionEntity,
      OwnershipTransferEntity,
      FleetCommunityEntity,
      StoFleetEntity,
      ScopeRoleAssignmentEntity,
      ScopeCapabilityGrantEntity,
      ScopeMembershipEntity,
      UserProfileEntity,
    ]),
  ],
  controllers: [
    CommunityGovernanceController,
    FleetGovernanceController,
    ArmadaGovernanceController,
    AdminFleetGovernanceController,
  ],
  providers: [
    OwnershipTransferService,
    ScopeClosureService,
    ScopeGovernanceLogService,
    ScopeRolesService,
  ],
})
export class FleetGovernanceModule {}
