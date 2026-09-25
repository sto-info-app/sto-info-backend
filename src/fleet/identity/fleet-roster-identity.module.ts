import { Module } from '@nestjs/common';

import { FleetModule } from '../fleet.module';
import { FleetRosterProjectionModule } from '../projection/fleet-roster-projection.module';
import { RosterIdentitiesController } from './roster-identities.controller';
import { RosterIdentityReviewService } from './services/roster-identity-review.service';

/**
 * Rename review: the routes investigators decide candidates through (FC-018).
 *
 * Working identities out is part of a Fleet's roster replay since FC-019, and
 * lives with it in {@link FleetRosterProjectionModule}. What is left here is
 * the review, which asks for a replay once a decision is recorded, so this
 * sits above the replay module and imports it.
 */
@Module({
  imports: [FleetModule, FleetRosterProjectionModule],
  controllers: [RosterIdentitiesController],
  providers: [RosterIdentityReviewService],
})
export class FleetRosterIdentityModule {}
