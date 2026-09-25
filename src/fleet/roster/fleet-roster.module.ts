import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RegistryModule } from 'src/registry/registry.module';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CharacterFleetMembershipEntity } from '../entities/character-fleet-membership.entity';
import { FleetModule } from '../fleet.module';
import { RosterIdentityAliasEntity } from '../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../imports/entities/roster-observation.entity';
import { RosterChangeEntity } from '../projection/entities/roster-change.entity';
import { RosterEpisodeEntity } from '../projection/entities/roster-episode.entity';
import { RosterIntervalSummaryEntity } from '../projection/entities/roster-interval-summary.entity';
import { RosterProjectionInputEntity } from '../projection/entities/roster-projection-input.entity';
import { RosterProjectionEntity } from '../projection/entities/roster-projection.entity';
import { FleetReportAudienceChangeEntity } from './entities/fleet-report-audience-change.entity';
import { FleetReportAudienceEntity } from './entities/fleet-report-audience.entity';
import { RosterRankOrderActionEntity } from './entities/roster-rank-order-action.entity';
import { RosterRankOrderEntity } from './entities/roster-rank-order.entity';
import { FleetReportsController } from './fleet-reports.controller';
import { RosterController } from './roster.controller';
import { FleetReportAccessService } from './services/fleet-report-access.service';
import { FleetReportAudienceService } from './services/fleet-report-audience.service';
import { FleetReportContextService } from './services/fleet-report-context.service';
import { PublishedRosterRevisionService } from './services/published-roster-revision.service';
import { RosterHistoryService } from './services/roster-history.service';
import { RosterMemberNameService } from './services/roster-member-name.service';
import { RosterProfileLinkService } from './services/roster-profile-link.service';
import { RosterRankOrderService } from './services/roster-rank-order.service';
import { RosterTimelineService } from './services/roster-timeline.service';
import { RosterViewService } from './services/roster-view.service';

/**
 * What a Fleet's roster history is read as: the roster, the history and the
 * reports, with the rank order and report audiences that shape them
 * (FC-020).
 *
 * The top of the roster modules. It reads what the imports, identities and
 * projection wrote, always pinned to a published revision, and writes only
 * its own settings, so nothing below it needs anything of it.
 */
@Module({
  imports: [
    FleetModule,
    RegistryModule,
    TypeOrmModule.forFeature([
      RosterProjectionEntity,
      RosterProjectionInputEntity,
      RosterEpisodeEntity,
      RosterChangeEntity,
      RosterIntervalSummaryEntity,
      RosterObservationEntity,
      RosterIdentityAliasEntity,
      RosterRankOrderEntity,
      RosterRankOrderActionEntity,
      FleetReportAudienceEntity,
      FleetReportAudienceChangeEntity,
      CharacterEntity,
      CharacterFleetMembershipEntity,
    ]),
  ],
  controllers: [RosterController, FleetReportsController],
  providers: [
    FleetReportAccessService,
    FleetReportAudienceService,
    FleetReportContextService,
    PublishedRosterRevisionService,
    RosterHistoryService,
    RosterMemberNameService,
    RosterProfileLinkService,
    RosterRankOrderService,
    RosterTimelineService,
    RosterViewService,
  ],
})
export class FleetRosterModule {}
