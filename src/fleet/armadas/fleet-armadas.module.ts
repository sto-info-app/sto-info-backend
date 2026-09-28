import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from 'src/notification/notification.module';
import { GeneralFactionEntity } from 'src/sto/character/entities/general-faction.entity';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { ArmadaFleetMembershipEntity } from '../entities/armada-fleet-membership.entity';
import { FleetModule } from '../fleet.module';
import { ArmadaTopologyController } from './armada-topology.controller';
import { ArmadaActionEntity } from './entities/armada-action.entity';
import { ArmadaJoinRequestEntity } from './entities/armada-join-request.entity';
import { ArmadaArrangeService } from './services/armada-arrange.service';
import { ArmadaNotifierService } from './services/armada-notifier.service';
import { ArmadaRequestService } from './services/armada-request.service';
import { ArmadaViewService } from './services/armada-view.service';

/**
 * How Fleets are arranged in Armadas: requests to join, placements, moves,
 * departures and their history (FC-024 to FC-026).
 *
 * Above the Fleet domain, whose authorisation and audiences it reads. The
 * placement rules themselves are plain functions over a transaction, so the
 * Fleet domain and governance can end placements when an Armada or a Fleet
 * closes without depending on this module.
 */
@Module({
  imports: [
    FleetModule,
    NotificationModule,
    TypeOrmModule.forFeature([
      ArmadaJoinRequestEntity,
      ArmadaActionEntity,
      ArmadaFleetMembershipEntity,
      GeneralFactionEntity,
      PlatformEntity,
      UserProfileEntity,
    ]),
  ],
  controllers: [ArmadaTopologyController],
  providers: [
    ArmadaArrangeService,
    ArmadaNotifierService,
    ArmadaRequestService,
    ArmadaViewService,
  ],
})
export class FleetArmadasModule {}
