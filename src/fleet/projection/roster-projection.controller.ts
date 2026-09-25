import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { RosterProjectionStatusDto } from './dto/roster-projection-status.dto';
import { RosterProjectionStatusService } from './services/roster-projection-status.service';

/**
 * Where a Fleet's roster history stands (FC-019).
 *
 * Open to whoever sends a Fleet's rosters and whoever investigates them, as
 * the import list is: both need to know whether what they uploaded or
 * corrected has reached the history yet, and which imports it was built
 * from. The roster, history and reports themselves are FC-020's.
 */
@ApiTags('Fleet')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/fleets/:fleetId/roster-projection')
export class RosterProjectionController {
  /**
   * Creates an instance of RosterProjectionController.
   *
   * @param _statusService - Reads the projection's state.
   * @param _featureService - Reports whether imports are switched on.
   */
  constructor(
    private readonly _statusService: RosterProjectionStatusService,
    private readonly _featureService: FleetFeatureService,
  ) {}

  /**
   * Reports the Fleet's published revision and what it was built from.
   *
   * @param fleetId - The Fleet.
   * @returns The revision, whether it is stale, and its inputs.
   */
  @Get()
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(
    [FLEET_CAPABILITIES.ROSTER_IMPORT, FLEET_CAPABILITIES.ROSTER_INVESTIGATE],
    {
      kind: FleetScopeKind.FLEET,
      param: 'fleetId',
      communityParam: 'communityId',
    },
  )
  @ApiOperation({ summary: "Report where this Fleet's roster history stands" })
  @ApiOkResponse({ type: RosterProjectionStatusDto })
  async status(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
  ): Promise<RosterProjectionStatusDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    return this._statusService.status(fleetId);
  }
}
