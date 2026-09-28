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
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId, UserId } from 'src/auth/user-id.decorator';

import { FleetAudienceService } from '../authorisation/fleet-audience.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { StoFleetService } from '../services/sto-fleet.service';
import {
  FleetHoldingHistoryPageDto,
  FleetHoldingHistoryQueryDto,
  FleetHoldingsDto,
  RecordFleetHoldingDto,
} from './dto/fleet-holdings.dto';
import { FleetHoldingsService } from './services/fleet-holdings.service';

/** Where every guarded route here finds its Fleet. */
const FLEET_SOURCE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
} as const;

/**
 * A Fleet's holdings: the tier of each, recorded by hand, and their history
 * (FC-023).
 *
 * Reading is for whoever may see the Fleet, signed in or not. Recording
 * needs `holdings.write` at the Fleet.
 */
@ApiTags('Fleet holdings')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/fleets/:fleetId/holdings')
export class FleetHoldingsController {
  /**
   * Creates an instance of FleetHoldingsController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _fleetService - Reads Fleets.
   * @param _audienceService - Says who may see a Fleet.
   * @param _holdingsService - Reads and records holdings.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _fleetService: StoFleetService,
    private readonly _audienceService: FleetAudienceService,
    private readonly _holdingsService: FleetHoldingsService,
  ) {}

  /**
   * Reads where a Fleet's holdings stand.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The viewer, or null when signed out.
   * @returns Every holding, with its tracks' tiers.
   */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read a Fleet’s holdings' })
  @ApiOkResponse({ type: FleetHoldingsDto })
  @ApiNotFoundResponse({
    description: 'No such Fleet, or the caller may not see it.',
  })
  async view(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<FleetHoldingsDto> {
    const fleet = await this.visibleFleet(communityId, fleetId, userId);

    return this._holdingsService.view(fleet, userId);
  }

  /**
   * Reads a page of a Fleet's holdings history, newest first.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The viewer, or null when signed out.
   * @param query - Which page.
   * @returns The changes.
   */
  @Get('history')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read how a Fleet’s holdings changed' })
  @ApiOkResponse({ type: FleetHoldingHistoryPageDto })
  @ApiNotFoundResponse({
    description: 'No such Fleet, or the caller may not see it.',
  })
  async history(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @OptionalUserId() userId: string | null,
    @Query() query: FleetHoldingHistoryQueryDto,
  ): Promise<FleetHoldingHistoryPageDto> {
    const fleet = await this.visibleFleet(communityId, fleetId, userId);

    return this._holdingsService.history(fleet, userId, query);
  }

  /**
   * Records the tiers of one holding.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param holdingCode - The holding, such as STARBASE.
   * @param userId - The recorder.
   * @param dto - The tracks to set, and why.
   * @returns Where the Fleet's holdings now stand.
   */
  @Put(':holdingCode')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.HOLDINGS_WRITE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Record the tiers of a Fleet holding' })
  @ApiOkResponse({ type: FleetHoldingsDto })
  @ApiBadRequestResponse({
    description:
      'A track of another holding, a tier out of bounds, or nothing to change.',
  })
  @ApiNotFoundResponse({ description: 'No such Fleet or holding.' })
  @ApiConflictResponse({ description: 'The Fleet is closed.' })
  async record(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('holdingCode') holdingCode: string,
    @UserId() userId: string,
    @Body() dto: RecordFleetHoldingDto,
  ): Promise<FleetHoldingsDto> {
    await this._featureService.assertEnabled();
    await this._holdingsService.record(
      communityId,
      fleetId,
      holdingCode,
      dto,
      userId,
    );

    return this._holdingsService.view(
      await this._fleetService.findByIdOrFail(communityId, fleetId),
      userId,
    );
  }

  /**
   * Finds a Fleet the viewer may see.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The viewer, or null when signed out.
   * @returns The Fleet.
   * @throws NotFoundException when there is none, or they may not see it.
   */
  private async visibleFleet(
    communityId: string,
    fleetId: string,
    userId: string | null,
  ): Promise<StoFleetEntity> {
    await this._featureService.assertEnabled();

    const fleet = await this._fleetService.findByIdOrFail(communityId, fleetId);

    await this._audienceService.assertCanViewFleet(fleet, userId);

    return fleet;
  }
}
