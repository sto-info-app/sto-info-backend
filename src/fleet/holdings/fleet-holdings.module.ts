import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FleetModule } from '../fleet.module';
import { FleetHoldingChangeEntity } from './entities/fleet-holding-change.entity';
import { FleetHoldingHistoryEntity } from './entities/fleet-holding-history.entity';
import { FleetHoldingStatusEntity } from './entities/fleet-holding-status.entity';
import { FleetHoldingTierEntity } from './entities/fleet-holding-tier.entity';
import { FleetHoldingTrackEntity } from './entities/fleet-holding-track.entity';
import { FleetHoldingTypeEntity } from './entities/fleet-holding-type.entity';
import { FleetHoldingsController } from './fleet-holdings.controller';
import { FleetHoldingsService } from './services/fleet-holdings.service';

/**
 * The tiers of a Fleet's holdings, recorded by hand (FC-023).
 *
 * Above the Fleet domain, whose authorisation it reads. Nothing below it
 * needs anything of it.
 */
@Module({
  imports: [
    FleetModule,
    TypeOrmModule.forFeature([
      FleetHoldingTypeEntity,
      FleetHoldingTrackEntity,
      FleetHoldingTierEntity,
      FleetHoldingStatusEntity,
      FleetHoldingChangeEntity,
      FleetHoldingHistoryEntity,
    ]),
  ],
  controllers: [FleetHoldingsController],
  providers: [FleetHoldingsService],
})
export class FleetHoldingsModule {}
