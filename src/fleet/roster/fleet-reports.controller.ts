import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId, UserId } from 'src/auth/user-id.decorator';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { FleetContributionReportDto } from './dto/fleet-contribution-report.dto';
import {
  FleetActivityReportDto,
  FleetGrowthReportDto,
} from './dto/fleet-growth-report.dto';
import {
  FleetReportAudiencesDto,
  SetFleetReportAudienceDto,
} from './dto/fleet-report-audience.dto';
import { FleetReportQueryDto } from './dto/fleet-report-query.dto';
import { FleetReportAccessDto } from './dto/fleet-report.dto';
import {
  FleetRanksReportDto,
  FleetTenureReportDto,
} from './dto/fleet-tenure-report.dto';
import { FleetReport } from './enums/fleet-report.enum';
import { FleetContributionReportService } from './services/fleet-contribution-report.service';
import { FleetGrowthReportService } from './services/fleet-growth-report.service';
import { FleetReportAccessService } from './services/fleet-report-access.service';
import { FleetReportAudienceService } from './services/fleet-report-audience.service';
import {
  FleetReportContext,
  FleetReportContextService,
} from './services/fleet-report-context.service';
import { FleetTenureReportService } from './services/fleet-tenure-report.service';

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
   * @param _accessService - Decides how much of each report a viewer sees.
   * @param _contextService - Opens a report over its revision and span.
   * @param _growthService - Builds the growth and activity reports.
   * @param _tenureService - Builds the tenure and ranks reports.
   * @param _contributionService - Builds the contribution report.
   * @param _featureService - Reports whether imports are switched on.
   */
  constructor(
    private readonly _audienceService: FleetReportAudienceService,
    private readonly _accessService: FleetReportAccessService,
    private readonly _contextService: FleetReportContextService,
    private readonly _growthService: FleetGrowthReportService,
    private readonly _tenureService: FleetTenureReportService,
    private readonly _contributionService: FleetContributionReportService,
    private readonly _featureService: FleetFeatureService,
  ) {}

  /**
   * Lists the reports a viewer may see, and how much of each.
   *
   * Open to anybody, signed in or not. A viewer who may not see the Fleet,
   * or any of its reports, is given an empty list, the same answer as a
   * Fleet with nothing to show them.
   *
   * @param communityId - The Community, as the path names it.
   * @param fleetId - The Fleet.
   * @param userId - The viewer, or null when signed out.
   * @returns Each report they may see, in the reports' order.
   */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'List the reports of this Fleet the viewer may see',
  })
  @ApiOkResponse({ type: [FleetReportAccessDto] })
  async list(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<FleetReportAccessDto[]> {
    await this.assertEnabled();

    const views = await this._accessService.visible(
      {
        kind: FleetScopeKind.FLEET,
        id: fleetId,
        withinCommunityId: communityId,
      },
      userId,
    );

    return [...views].map(([report, view]) => ({ report, view }));
  }

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
   * Reads the growth report.
   *
   * @param communityId - The Community, as the path names it.
   * @param fleetId - The Fleet.
   * @param query - The span.
   * @param userId - The viewer, or null when signed out.
   * @returns The report, as much of it as the viewer is shown.
   */
  @Get('growth')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Read this Fleet's growth report" })
  @ApiOkResponse({ type: FleetGrowthReportDto })
  @ApiNotFoundResponse({ description: 'The viewer may not see it.' })
  async growth(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: FleetReportQueryDto,
    @OptionalUserId() userId: string | null,
  ): Promise<FleetGrowthReportDto> {
    return this._growthService.growth(
      await this.open(communityId, fleetId, FleetReport.GROWTH, query, userId),
    );
  }

  /**
   * Reads the activity report.
   *
   * @param communityId - The Community, as the path names it.
   * @param fleetId - The Fleet.
   * @param query - The span.
   * @param userId - The viewer, or null when signed out.
   * @returns The report, as much of it as the viewer is shown.
   */
  @Get('activity')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Read this Fleet's activity report" })
  @ApiOkResponse({ type: FleetActivityReportDto })
  @ApiNotFoundResponse({ description: 'The viewer may not see it.' })
  async activity(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: FleetReportQueryDto,
    @OptionalUserId() userId: string | null,
  ): Promise<FleetActivityReportDto> {
    return this._growthService.activity(
      await this.open(
        communityId,
        fleetId,
        FleetReport.ACTIVITY,
        query,
        userId,
      ),
    );
  }

  /**
   * Reads the tenure report.
   *
   * @param communityId - The Community, as the path names it.
   * @param fleetId - The Fleet.
   * @param query - The span, and the export its members are listed at.
   * @param userId - The viewer, or null when signed out.
   * @returns The report, as much of it as the viewer is shown.
   */
  @Get('tenure')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Read this Fleet's tenure report" })
  @ApiOkResponse({ type: FleetTenureReportDto })
  @ApiNotFoundResponse({ description: 'The viewer may not see it.' })
  async tenure(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: FleetReportQueryDto,
    @OptionalUserId() userId: string | null,
  ): Promise<FleetTenureReportDto> {
    return this._tenureService.tenure(
      await this.open(communityId, fleetId, FleetReport.TENURE, query, userId),
    );
  }

  /**
   * Reads the ranks report.
   *
   * @param communityId - The Community, as the path names it.
   * @param fleetId - The Fleet.
   * @param query - The span.
   * @param userId - The viewer, or null when signed out.
   * @returns The report, as much of it as the viewer is shown.
   */
  @Get('ranks')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Read this Fleet's ranks report" })
  @ApiOkResponse({ type: FleetRanksReportDto })
  @ApiNotFoundResponse({ description: 'The viewer may not see it.' })
  async ranks(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: FleetReportQueryDto,
    @OptionalUserId() userId: string | null,
  ): Promise<FleetRanksReportDto> {
    return this._tenureService.ranks(
      await this.open(communityId, fleetId, FleetReport.RANKS, query, userId),
    );
  }

  /**
   * Reads the contribution report.
   *
   * @param communityId - The Community, as the path names it.
   * @param fleetId - The Fleet.
   * @param query - The span, and the export ending the interval whose
   *   members are listed.
   * @param userId - The viewer, or null when signed out.
   * @returns The report, as much of it as the viewer is shown.
   */
  @Get('contribution')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Read this Fleet's contribution report" })
  @ApiOkResponse({ type: FleetContributionReportDto })
  @ApiNotFoundResponse({ description: 'The viewer may not see it.' })
  async contribution(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: FleetReportQueryDto,
    @OptionalUserId() userId: string | null,
  ): Promise<FleetContributionReportDto> {
    return this._contributionService.contribution(
      await this.open(
        communityId,
        fleetId,
        FleetReport.CONTRIBUTION,
        query,
        userId,
      ),
    );
  }

  /**
   * Opens a report for a viewer, as much of it as they are shown.
   *
   * @param communityId - The Community, as the path names it.
   * @param fleetId - The Fleet.
   * @param report - The report.
   * @param query - The span, and the export for its detail.
   * @param userId - The viewer, or null when signed out.
   * @returns What it is built from.
   * @throws NotFoundException when imports are off or the viewer may not see
   *   it.
   */
  private async open(
    communityId: string,
    fleetId: string,
    report: FleetReport,
    query: FleetReportQueryDto,
    userId: string | null,
  ): Promise<FleetReportContext> {
    await this.assertEnabled();

    const view = await this._accessService.require(
      {
        kind: FleetScopeKind.FLEET,
        id: fleetId,
        withinCommunityId: communityId,
      },
      report,
      userId,
    );

    return this._contextService.open(fleetId, report, view, query);
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
