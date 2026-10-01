import { Module } from '@nestjs/common';

import { ActivityModule } from '../activity/activity.module';
import { ChatModule } from '../chat/chat.module';
import { FleetModule } from '../fleet.module';
import { FleetRosterImportsModule } from '../imports/fleet-roster-imports.module';
import { ScopeNewsModule } from '../news/scope-news.module';
import { FleetRetentionScheduler } from './fleet-retention.scheduler';
import { RetentionRunService } from './retention-run.service';

/**
 * The Fleet's retention jobs (FC-037): when each runs, and the record of
 * every run. Each job lives with what it deletes.
 */
@Module({
  imports: [
    ActivityModule,
    ChatModule,
    FleetModule,
    FleetRosterImportsModule,
    ScopeNewsModule,
  ],
  providers: [RetentionRunService, FleetRetentionScheduler],
  // The restore check catches every job up at boot (FC-043).
  exports: [FleetRetentionScheduler],
})
export class FleetRetentionModule {}
