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

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  RosterImportConflictPageDto,
  RosterImportConflictQueryDto,
} from './dto/roster-import-conflicts.dto';
import { RosterImportStatusService } from './services/roster-import-status.service';

/**
 * A Fleet's conflicting exports, for its investigators to settle (FC-020).
 *
 * Its own path rather than beside the imports, whose `:importId` would
 * otherwise read `conflicts` as an import. Selecting one export of a group
 * is the import's own route: `POST …/roster-imports/:importId/selection`.
 */
@ApiTags('Fleet')
@ApiBearerAuth()
@Controller(
  'fleet-communities/:communityId/fleets/:fleetId/roster-import-conflicts',
)
export class RosterImportConflictsController {
  /**
   * Creates an instance of RosterImportConflictsController.
   *
   * @param _statusService - Reports the groups and their exports.
   * @param _featureService - Reports whether imports are switched on.
   */
  constructor(
    private readonly _statusService: RosterImportStatusService,
    private readonly _featureService: FleetFeatureService,
  ) {}

  /**
   * Lists a Fleet's conflict groups, latest moment first.
   *
   * @param fleetId - The Fleet.
   * @param query - Which groups, and which page.
   * @returns The page.
   */
  @Get()
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_INVESTIGATE, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: "List this Fleet's conflicting roster exports" })
  @ApiOkResponse({ type: RosterImportConflictPageDto })
  async list(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: RosterImportConflictQueryDto,
  ): Promise<RosterImportConflictPageDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    return this._statusService.conflicts(
      fleetId,
      query.state,
      query.page,
      query.pageSize,
    );
  }
}
