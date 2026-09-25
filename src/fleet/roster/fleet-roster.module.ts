import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RegistryModule } from 'src/registry/registry.module';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CharacterFleetMembershipEntity } from '../entities/character-fleet-membership.entity';
import { FleetModule } from '../fleet.module';
import { RosterIdentityAliasEntity } from '../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../imports/entities/roster-observation.entity';
import { RosterProjectionInputEntity } from '../projection/entities/roster-projection-input.entity';
import { RosterProjectionEntity } from '../projection/entities/roster-projection.entity';
import { FleetReportAudienceChangeEntity } from './entities/fleet-report-audience-change.entity';
import { FleetReportAudienceEntity } from './entities/fleet-report-audience.entity';
import { RosterRankOrderActionEntity } from './entities/roster-rank-order-action.entity';
import { RosterRankOrderEntity } from './entities/roster-rank-order.entity';
import { RosterController } from './roster.controller';
import { PublishedRosterRevisionService } from './services/published-roster-revision.service';
import { RosterProfileLinkService } from './services/roster-profile-link.service';
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
  controllers: [RosterController],
  providers: [
    PublishedRosterRevisionService,
    RosterProfileLinkService,
    RosterViewService,
  ],
})
export class FleetRosterModule {}
