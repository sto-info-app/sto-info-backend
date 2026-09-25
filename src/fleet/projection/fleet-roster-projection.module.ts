import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { QueueModule } from 'src/shared/queue/queue.module';

import { FleetModule } from '../fleet.module';
import { RosterIdentityRecomputeService } from '../identity/services/roster-identity-recompute.service';
import { ROSTER_REPLAY_QUEUE } from './constants/roster-replay.constants';
import { RosterChangeEntity } from './entities/roster-change.entity';
import { RosterEpisodeEntity } from './entities/roster-episode.entity';
import { RosterIntervalSummaryEntity } from './entities/roster-interval-summary.entity';
import { RosterProjectionInputEntity } from './entities/roster-projection-input.entity';
import { RosterProjectionEntity } from './entities/roster-projection.entity';
import { RosterReplayProcessor } from './processors/roster-replay.processor';
import { RosterReplayEvidenceService } from './services/roster-replay-evidence.service';
import { RosterReplayQueueService } from './services/roster-replay-queue.service';
import { RosterReplaySweepService } from './services/roster-replay-sweep.service';
import { RosterReplayService } from './services/roster-replay.service';

/**
 * A Fleet's roster replay: identities, history and the revision they are
 * published as (FC-019).
 *
 * The lowest of the roster modules, below identities and imports, and that
 * is a dependency decision. Both of them change a Fleet's evidence or
 * decisions and have to ask for a replay, so both import this for
 * {@link RosterReplayQueueService}; this needs nothing of either but the
 * identity recompute, which it provides itself from the identity folder,
 * and the tables, which it reads through the replay's own manager. Importing
 * either would close a loop.
 */
@Module({
  imports: [
    FleetModule,
    QueueModule,
    BullModule.registerQueue({ name: ROSTER_REPLAY_QUEUE }),
    TypeOrmModule.forFeature([
      RosterProjectionEntity,
      RosterProjectionInputEntity,
      RosterEpisodeEntity,
      RosterChangeEntity,
      RosterIntervalSummaryEntity,
    ]),
  ],
  providers: [
    RosterIdentityRecomputeService,
    RosterReplayEvidenceService,
    RosterReplayQueueService,
    RosterReplayService,
    RosterReplayProcessor,
    RosterReplaySweepService,
  ],
  exports: [RosterReplayQueueService],
})
export class FleetRosterProjectionModule {}
