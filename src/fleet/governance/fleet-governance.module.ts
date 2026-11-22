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
import { FleetCommunityMapper } from '../mappers/fleet-community.mapper';
import {
  AdminFleetCommunityLookupController,
  AdminFleetCommunitySearchController,
  AdminFleetGovernanceController,
  AdminFleetInvestigationsController,
} from './admin-fleet-governance.controller';
import { ArmadaGovernanceController } from './armada-governance.controller';
import { CommunityGovernanceController } from './community-governance.controller';
import { FleetInvestigationGrantEntity } from './entities/fleet-investigation-grant.entity';
import { OwnershipTransferEntity } from './entities/ownership-transfer.entity';
import { ScopeGovernanceActionEntity } from './entities/scope-governance-action.entity';
import { FleetGovernanceController } from './fleet-governance.controller';
import { AdminCommunitySearchService } from './services/admin-community-search.service';
import { CommunityOwnerDepartureService } from './services/community-owner-departure.service';
import { DisputeRegistrationsService } from './services/dispute-registrations.service';
import { FleetInvestigationService } from './services/fleet-investigation.service';
import { OwnershipTransferService } from './services/ownership-transfer.service';
import { ScopeClosureService } from './services/scope-closure.service';
import { ScopeGovernanceLogService } from './services/scope-governance-log.service';
import { ScopeRolesService } from './services/scope-roles.service';
import { ScopeSuspensionService } from './services/scope-suspension.service';

/**
 * Who governs a Community or Fleet: roles, delegation, ownership and closure
 * (FC-022), and a site admin's suspensions, disputes and looks into a Fleet
 * (FC-036).
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
      FleetInvestigationGrantEntity,
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
    AdminFleetCommunitySearchController,
    // Before the dispute routes, so `by-slug` is never read as an identifier.
    AdminFleetCommunityLookupController,
    AdminFleetGovernanceController,
    AdminFleetInvestigationsController,
  ],
  providers: [
    AdminCommunitySearchService,
    CommunityOwnerDepartureService,
    OwnershipTransferService,
    ScopeClosureService,
    ScopeGovernanceLogService,
    ScopeRolesService,
    ScopeSuspensionService,
    DisputeRegistrationsService,
    FleetInvestigationService,
    FleetCommunityMapper,
  ],
  exports: [CommunityOwnerDepartureService],
})
export class FleetGovernanceModule {}
