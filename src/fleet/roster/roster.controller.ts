import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { FleetAuthorisationService } from '../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { RosterPageDto } from './dto/roster-page.dto';
import { RosterQueryDto } from './dto/roster-query.dto';
import { RosterViewService } from './services/roster-view.service';

/**
 * A Fleet's roster, as its exports listed it (FC-020).
 *
 * The private roster: for `roster.view` holders only, which following a
 * Community never confers (FC-015).
 */
@ApiTags('Fleet')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/fleets/:fleetId/roster')
export class RosterController {
  /**
   * Creates an instance of RosterController.
   *
   * @param _viewService - Reads the roster.
   * @param _authorisationService - Tells an investigator from a reader.
   * @param _featureService - Reports whether imports are switched on.
   */
  constructor(
    private readonly _viewService: RosterViewService,
    private readonly _authorisationService: FleetAuthorisationService,
    private readonly _featureService: FleetFeatureService,
  ) {}

  /**
   * Reads a page of the roster as one effective export listed it.
   *
   * @param fleetId - The Fleet.
   * @param query - The export, page, ordering and filters asked for.
   * @param userId - The reader.
   * @returns The page, with the revision and export it was read from.
   */
  @Get()
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_VIEW, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: "Read a page of this Fleet's roster" })
  @ApiOkResponse({ type: RosterPageDto })
  async roster(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: RosterQueryDto,
    @UserId() userId: string,
  ): Promise<RosterPageDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    const investigator = await this._authorisationService.hasCapability(
      userId,
      { kind: FleetScopeKind.FLEET, id: fleetId },
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
    );

    return this._viewService.page(fleetId, query, { userId, investigator });
  }
}
