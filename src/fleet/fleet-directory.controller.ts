import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  FleetCommunityDirectoryQueryDto,
  StoArmadaDirectoryQueryDto,
  StoFleetDirectoryQueryDto,
} from './dto/fleet-directory-query.dto';
import {
  FleetCommunityDirectoryPageDto,
  StoArmadaDirectoryPageDto,
  StoFleetDirectoryPageDto,
} from './dto/fleet-directory.dto';
import { FleetFeatureService } from './fleet-feature.service';
import { FleetCommunityMapper } from './mappers/fleet-community.mapper';
import { StoArmadaMapper } from './mappers/sto-armada.mapper';
import { StoFleetMapper } from './mappers/sto-fleet.mapper';
import { FleetCommunityService } from './services/fleet-community.service';
import { StoArmadaService } from './services/sto-armada.service';
import { StoFleetService } from './services/sto-fleet.service';

/**
 * The three public directories: Communities, Fleets and Armadas.
 *
 * ## Why all three live together
 *
 * Because they share the one rule that matters. Every route here lists
 * `PUBLIC` records and nothing else, and it does so in SQL rather than by
 * checking each row, since a page of fifty would otherwise be fifty
 * authorisation queries. A rule enforced by a `WHERE` clause is a rule that
 * leaks the moment somebody adds a fourth listing and copies the wrong half
 * of an existing one, so the three sit in one file with one spec asserting
 * that none of them takes a token or a capability.
 *
 * The lifecycle of a single Community is still {@link FleetCommunitiesController}'s;
 * a single Fleet or Armada under one is still the nested controllers'. This
 * is the browse surface alone.
 *
 * ## Why there is no guard
 *
 * Not an omission. The answer does not depend on who is asking — the same
 * records, in the same order, signed in or out — so there is nothing to
 * authenticate and nothing an account would unlock. A member wanting their
 * own Community's private Fleets reads them through that Community's routes,
 * where the check is made once against a scope named in the path.
 *
 * The feature switch still applies, and answers `404` rather than
 * "disabled", so a staged rollout does not advertise what is coming.
 */
@ApiTags('Fleet')
@Controller()
export class FleetDirectoryController {
  /**
   * Creates an instance of FleetDirectoryController.
   *
   * @param _communityService - Lists Communities.
   * @param _fleetService - Lists Fleets.
   * @param _armadaService - Lists Armadas.
   * @param _featureService - Reports whether the feature is switched on.
   * @param _communityMapper - Turns a Community into its card.
   * @param _fleetMapper - Turns a Fleet into its card.
   * @param _armadaMapper - Turns an Armada into its card.
   */
  constructor(
    private readonly _communityService: FleetCommunityService,
    private readonly _fleetService: StoFleetService,
    private readonly _armadaService: StoArmadaService,
    private readonly _featureService: FleetFeatureService,
    private readonly _communityMapper: FleetCommunityMapper,
    private readonly _fleetMapper: StoFleetMapper,
    private readonly _armadaMapper: StoArmadaMapper,
  ) {}

  /**
   * Lists public Fleet Communities.
   *
   * @param query - Search, filters, ordering and paging.
   * @returns A page of Community cards.
   */
  @Get('fleet-communities')
  @ApiOperation({ summary: 'Browse Fleet Communities' })
  @ApiOkResponse({ type: FleetCommunityDirectoryPageDto })
  async listCommunities(
    @Query() query: FleetCommunityDirectoryQueryDto,
  ): Promise<FleetCommunityDirectoryPageDto> {
    await this._featureService.assertEnabled();

    const found = await this._communityService.findDirectoryPage(query);

    return {
      items: found.items.map(community =>
        this._communityMapper.toCardDto(community),
      ),
      total: found.total,
      page: found.page,
      pageSize: found.pageSize,
    };
  }

  /**
   * Lists public Fleets, each with how many others answer to its name.
   *
   * @param query - Search, filters, ordering and paging.
   * @returns A page of Fleet cards.
   */
  @Get('fleets')
  @ApiOperation({
    summary: 'Browse Fleets',
    description:
      'Ordered by name by default, so the records answering to one name are ' +
      'read together, and each card says how many others do.',
  })
  @ApiOkResponse({ type: StoFleetDirectoryPageDto })
  async listFleets(
    @Query() query: StoFleetDirectoryQueryDto,
  ): Promise<StoFleetDirectoryPageDto> {
    await this._featureService.assertEnabled();

    const found = await this._fleetService.findDirectoryPage(query);

    return {
      items: found.items.map(entry => this._fleetMapper.toCardDto(entry)),
      total: found.total,
      page: found.page,
      pageSize: found.pageSize,
    };
  }

  /**
   * Lists Armadas held by public Communities.
   *
   * @param query - Search, filters, ordering and paging.
   * @returns A page of Armada cards.
   */
  @Get('armadas')
  @ApiOperation({
    summary: 'Browse Armadas',
    description:
      'An Armada is listed when the Community holding it is public: it has ' +
      'no audience of its own, and is seen exactly as far as its Community.',
  })
  @ApiOkResponse({ type: StoArmadaDirectoryPageDto })
  async listArmadas(
    @Query() query: StoArmadaDirectoryQueryDto,
  ): Promise<StoArmadaDirectoryPageDto> {
    await this._featureService.assertEnabled();

    const found = await this._armadaService.findDirectoryPage(query);

    return {
      items: found.items.map(entry => this._armadaMapper.toCardDto(entry)),
      total: found.total,
      page: found.page,
      pageSize: found.pageSize,
    };
  }
}
