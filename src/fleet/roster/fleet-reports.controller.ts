import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  FleetReportAudiencesDto,
  SetFleetReportAudienceDto,
} from './dto/fleet-report-audience.dto';
import { FleetReport } from './enums/fleet-report.enum';
import { FleetReportAudienceService } from './services/fleet-report-audience.service';

/** Where every route here finds its Fleet, for the capability guard. */
const FLEET_SOURCE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
} as const;

/**
 * A Fleet's reports and who may see each (FC-020).
 */
@ApiTags('Fleet')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/fleets/:fleetId/reports')
export class FleetReportsController {
  /**
   * Creates an instance of FleetReportsController.
   *
   * @param _audienceService - Reads and changes each report's audience.
   * @param _featureService - Reports whether imports are switched on.
   */
  constructor(
    private readonly _audienceService: FleetReportAudienceService,
    private readonly _featureService: FleetFeatureService,
  ) {}

  /**
   * Reads every report's audience and every change to one.
   *
   * For `reports.view` holders — the Owner and Admins (Steve's decision of
   * 25 September 2026). Anybody else learns only whether a report is shown
   * to them.
   *
   * @param fleetId - The Fleet.
   * @returns The audiences and their changes.
   */
  @Get('audiences')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.REPORTS_VIEW, FLEET_SOURCE)
  @ApiOperation({ summary: "Read who may see each of this Fleet's reports" })
  @ApiOkResponse({ type: FleetReportAudiencesDto })
  async audiences(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
  ): Promise<FleetReportAudiencesDto> {
    await this.assertEnabled();

    return this._audienceService.audiences(fleetId);
  }

  /**
   * Changes who may see one report.
   *
   * For the Owner alone: `scope.settings.manage`, which is not delegable.
   *
   * @param fleetId - The Fleet.
   * @param report - The report.
   * @param userId - The Owner.
   * @param body - The new audience.
   * @returns The audiences and their changes, as after it.
   */
  @Put(':report/audience')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(
    FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE,
    FLEET_SOURCE,
  )
  @ApiOperation({ summary: 'Change who may see one of this Fleet’s reports' })
  @ApiOkResponse({ type: FleetReportAudiencesDto })
  @ApiBadRequestResponse({ description: 'It has that audience already.' })
  async setAudience(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('report', new ParseEnumPipe(FleetReport)) report: FleetReport,
    @UserId() userId: string,
    @Body() body: SetFleetReportAudienceDto,
  ): Promise<FleetReportAudiencesDto> {
    await this.assertEnabled();

    return this._audienceService.set(fleetId, report, body.audience, userId);
  }

  /**
   * Refuses while imports are switched off.
   *
   * @throws NotFoundException when they are.
   */
  private async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );
  }
}
