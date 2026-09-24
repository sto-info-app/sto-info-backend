import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QueueModule } from 'src/shared/queue/queue.module';

import { FleetModule } from '../fleet.module';
import { ROSTER_IDENTITY_QUEUE } from './constants/roster-identity.constants';
import { RosterIdentityProcessor } from './processors/roster-identity.processor';
import { RosterIdentityQueueService } from './services/roster-identity-queue.service';
import { RosterIdentityRecomputeService } from './services/roster-identity-recompute.service';

/**
 * Roster identities, rename candidates and the proposals they raise (FC-018).
 *
 * Its own module, below the roster imports and above {@link FleetModule},
 * for the same reason the imports have theirs: the import publisher has to
 * ask for a recompute once an import is in force, and the recompute needs
 * the proposal service in `FleetModule`. Importing it the other way would
 * close a loop. The recompute reads the import and asset tables through its
 * transaction's manager rather than through the modules that own them, so
 * nothing here depends on the imports module.
 */
@Module({
  imports: [
    FleetModule,
    QueueModule,
    BullModule.registerQueue({ name: ROSTER_IDENTITY_QUEUE }),
  ],
  providers: [
    RosterIdentityQueueService,
    RosterIdentityRecomputeService,
    RosterIdentityProcessor,
  ],
  exports: [RosterIdentityQueueService],
})
export class FleetRosterIdentityModule {}
