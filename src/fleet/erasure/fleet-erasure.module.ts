import { Module } from '@nestjs/common';

import { FileAssetsModule } from 'src/file-assets/file-assets.module';

import { FleetRosterImportsModule } from '../imports/fleet-roster-imports.module';
import { FleetRosterProjectionModule } from '../projection/fleet-roster-projection.module';
import { ErasureLedgerService } from './erasure-ledger.service';
import { FleetErasureCoreModule } from './fleet-erasure-core.module';
import { RosterErasureService } from './roster-erasure.service';
import { RosterErasuresController } from './roster-erasures.controller';

/** The site admins' verified erasure of roster data (FC-038). */
@Module({
  imports: [
    FileAssetsModule,
    FleetErasureCoreModule,
    FleetRosterImportsModule,
    FleetRosterProjectionModule,
  ],
  controllers: [RosterErasuresController],
  providers: [ErasureLedgerService, RosterErasureService],
  exports: [RosterErasureService],
})
export class FleetErasureModule {}
