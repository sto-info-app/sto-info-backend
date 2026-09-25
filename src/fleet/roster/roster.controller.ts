import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
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
import { RosterHistoryQueryDto } from './dto/roster-history-query.dto';
import {
  RosterHistoryPageDto,
  RosterTimelineDto,
} from './dto/roster-history.dto';
import { RosterPageDto } from './dto/roster-page.dto';
import { RosterQueryDto } from './dto/roster-query.dto';
import {
  RosterRankOrderDto,
  UpdateRosterRankOrderDto,
} from './dto/roster-rank-order.dto';
import { RosterHistoryService } from './services/roster-history.service';
import { RosterRankOrderService } from './services/roster-rank-order.service';
import { RosterTimelineService } from './services/roster-timeline.service';
import {
  RosterViewer,
  RosterViewService,
} from './services/roster-view.service';

/** Where every route here finds its Fleet, for the capability guard. */
const FLEET_SOURCE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
} as const;

/**
 * A Fleet's roster and its history, as its exports listed them (FC-020).
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
   * @param _historyService - Reads the history.
   * @param _timelineService - Reads one member's history.
   * @param _rankOrderService - Reads and edits the rank order.
   * @param _authorisationService - Tells an investigator from a reader.
   * @param _featureService - Reports whether imports are switched on.
   */
  constructor(
    private readonly _viewService: RosterViewService,
    private readonly _historyService: RosterHistoryService,
    private readonly _timelineService: RosterTimelineService,
    private readonly _rankOrderService: RosterRankOrderService,
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
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_VIEW, FLEET_SOURCE)
  @ApiOperation({ summary: "Read a page of this Fleet's roster" })
  @ApiOkResponse({ type: RosterPageDto })
  async roster(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: RosterQueryDto,
    @UserId() userId: string,
  ): Promise<RosterPageDto> {
    await this.assertEnabled();

    return this._viewService.page(
      fleetId,
      query,
      await this.viewer(fleetId, userId),
    );
  }

  /**
   * Reads a page of the history, newest interval first.
   *
   * @param fleetId - The Fleet.
   * @param query - The page and kinds asked for.
   * @returns The page, with the revision it was read from.
   */
  @Get('history')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_VIEW, FLEET_SOURCE)
  @ApiOperation({ summary: "Read a page of this Fleet's roster history" })
  @ApiOkResponse({ type: RosterHistoryPageDto })
  async history(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: RosterHistoryQueryDto,
  ): Promise<RosterHistoryPageDto> {
    await this.assertEnabled();

    return this._historyService.page(fleetId, query);
  }

  /**
   * Reads one member's history.
   *
   * @param fleetId - The Fleet.
   * @param identityId - The member.
   * @param userId - The reader.
   * @returns Their episodes, changes and rows.
   */
  @Get('members/:identityId')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_VIEW, FLEET_SOURCE)
  @ApiOperation({ summary: "Read one member's history in this Fleet" })
  @ApiOkResponse({ type: RosterTimelineDto })
  @ApiNotFoundResponse({
    description: 'The published revision has nothing of that member.',
  })
  async timeline(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('identityId', ParseUUIDPipe) identityId: string,
    @UserId() userId: string,
  ): Promise<RosterTimelineDto> {
    await this.assertEnabled();

    return this._timelineService.timeline(
      fleetId,
      identityId,
      await this.viewer(fleetId, userId),
    );
  }

  /**
   * Reads the Fleet's rank order.
   *
   * Open to every roster reader, since each roster row already shows its
   * tier. Only an investigator is shown the labels to place and every edit.
   *
   * @param fleetId - The Fleet.
   * @param userId - The reader.
   * @returns The order.
   */
  @Get('rank-order')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_VIEW, FLEET_SOURCE)
  @ApiOperation({ summary: "Read this Fleet's rank order" })
  @ApiOkResponse({ type: RosterRankOrderDto })
  async rankOrder(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
  ): Promise<RosterRankOrderDto> {
    await this.assertEnabled();

    const { investigator } = await this.viewer(fleetId, userId);

    return this._rankOrderService.view(fleetId, investigator);
  }

  /**
   * Replaces the Fleet's rank order, with a reason.
   *
   * @param fleetId - The Fleet.
   * @param userId - The investigator.
   * @param body - The new order, the order as loaded, and why.
   * @returns The order as the investigator now sees it.
   */
  @Put('rank-order')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_INVESTIGATE, FLEET_SOURCE)
  @ApiOperation({ summary: "Replace this Fleet's rank order" })
  @ApiOkResponse({ type: RosterRankOrderDto })
  @ApiBadRequestResponse({
    description:
      'Nothing would change, or the order places a label no import listed.',
  })
  @ApiConflictResponse({
    description: 'The order changed since it was loaded.',
  })
  async updateRankOrder(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() body: UpdateRosterRankOrderDto,
  ): Promise<RosterRankOrderDto> {
    await this.assertEnabled();

    return this._rankOrderService.update(fleetId, userId, body);
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

  /**
   * Says who is reading, as far as it changes what they see.
   *
   * @param fleetId - The Fleet.
   * @param userId - The reader.
   * @returns The reader, and whether they investigate its rosters.
   */
  private async viewer(fleetId: string, userId: string): Promise<RosterViewer> {
    const investigator = await this._authorisationService.hasCapability(
      userId,
      { kind: FleetScopeKind.FLEET, id: fleetId },
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
    );

    return { userId, investigator };
  }
}
