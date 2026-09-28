import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { FleetCommunityService } from '../services/fleet-community.service';
import { StoArmadaService } from '../services/sto-armada.service';
import { StoFleetService } from '../services/sto-fleet.service';
import {
  ArmadaHistoryPageDto,
  ArmadaPageQueryDto,
  ArmadaReasonDto,
  ArmadaRequestPageDto,
  ArmadaRequestQueryDto,
  ArmadaSlotDto,
  ArmadaViewDto,
  CommunityStructureDto,
  CreateArmadaRequestDto,
  FleetArmadaViewDto,
  MoveArmadaFleetDto,
  RemoveArmadaFleetDto,
} from './dto/armada-topology.dto';
import { ArmadaArrangeService } from './services/armada-arrange.service';
import { ArmadaRequestService } from './services/armada-request.service';
import { ArmadaViewService } from './services/armada-view.service';

/** Where an Armada's guarded routes find it. */
const ARMADA_SOURCE = {
  kind: FleetScopeKind.ARMADA,
  param: 'armadaId',
  communityParam: 'communityId',
} as const;

/** Where a Fleet's guarded routes find it. */
const FLEET_SOURCE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
} as const;

/**
 * Armadas' shapes, requests to join them and their history (FC-024 to
 * FC-026).
 *
 * Reading an Armada's shape and history, a Fleet's Armada and a Community's
 * structure is for whoever may see them, signed in or not. Answering
 * requests and arranging an Armada needs `armada.manage` there; asking to
 * join, withdrawing and leaving need `armada.request` at the Fleet.
 */
@ApiTags('Fleet Armadas')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId')
export class ArmadaTopologyController {
  /**
   * Creates an instance of ArmadaTopologyController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _communityService - Reads Communities.
   * @param _armadaService - Reads Armadas.
   * @param _fleetService - Reads Fleets.
   * @param _audienceService - Says who may see what.
   * @param _viewService - Describes Armadas.
   * @param _requestService - Requests and their answers.
   * @param _arrangeService - Moves and removals.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _communityService: FleetCommunityService,
    private readonly _armadaService: StoArmadaService,
    private readonly _fleetService: StoFleetService,
    private readonly _audienceService: FleetAudienceService,
    private readonly _viewService: ArmadaViewService,
    private readonly _requestService: ArmadaRequestService,
    private readonly _arrangeService: ArmadaArrangeService,
  ) {}

  /**
   * Reads a Community's Armadas, each with its shape, and its Fleets in none.
   *
   * @param communityId - The Community.
   * @param userId - The reader, or null when signed out.
   * @returns The structure.
   */
  @Get('structure')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read how a Community’s Fleets are arranged' })
  @ApiOkResponse({ type: CommunityStructureDto })
  @ApiNotFoundResponse({ description: 'No such Community, or hidden.' })
  async communityStructure(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<CommunityStructureDto> {
    await this._featureService.assertEnabled();

    const community = await this._communityService.findByIdOrFail(communityId);

    await this._audienceService.assertCanView(
      community.visibility,
      { kind: FleetScopeKind.COMMUNITY, id: community.id },
      userId,
    );

    return this._viewService.communityStructure(community, userId);
  }

  /**
   * Reads an Armada's shape.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param userId - The reader, or null when signed out.
   * @returns Its shape, and what the reader may do.
   */
  @Get('armadas/:armadaId/structure')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read an Armada’s shape' })
  @ApiOkResponse({ type: ArmadaViewDto })
  @ApiNotFoundResponse({ description: 'No such Armada, or hidden.' })
  async view(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<ArmadaViewDto> {
    const armada = await this.visibleArmada(communityId, armadaId, userId);

    return this._viewService.view(armada, userId);
  }

  /**
   * Reads a page of an Armada's history, newest change first.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param userId - The reader, or null when signed out.
   * @param query - Which page.
   * @returns The changes.
   */
  @Get('armadas/:armadaId/history')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read how an Armada changed' })
  @ApiOkResponse({ type: ArmadaHistoryPageDto })
  @ApiNotFoundResponse({ description: 'No such Armada, or hidden.' })
  async history(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @OptionalUserId() userId: string | null,
    @Query() query: ArmadaPageQueryDto,
  ): Promise<ArmadaHistoryPageDto> {
    const armada = await this.visibleArmada(communityId, armadaId, userId);

    return this._viewService.history(armada, userId, query);
  }

  /**
   * Lists an Armada's requests, for its managers.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param userId - The manager.
   * @param query - Which status, and which page.
   * @returns The requests.
   */
  @Get('armadas/:armadaId/requests')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ARMADA_MANAGE, ARMADA_SOURCE)
  @ApiOperation({ summary: 'List requests to join an Armada' })
  @ApiOkResponse({ type: ArmadaRequestPageDto })
  async requests(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @UserId() userId: string,
    @Query() query: ArmadaRequestQueryDto,
  ): Promise<ArmadaRequestPageDto> {
    await this._featureService.assertEnabled();

    return this._viewService.requests(
      await this._armadaService.findByIdOrFail(communityId, armadaId),
      userId,
      query,
    );
  }

  /**
   * Approves a request, placing the Fleet.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param requestId - The request.
   * @param userId - The approver.
   * @param dto - Where the Fleet goes.
   * @returns The Armada's shape now.
   */
  @Post('armadas/:armadaId/requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ARMADA_MANAGE, ARMADA_SOURCE)
  @ApiOperation({ summary: 'Approve a request to join an Armada' })
  @ApiOkResponse({ type: ArmadaViewDto })
  @ApiBadRequestResponse({ description: 'The place does not fit.' })
  @ApiConflictResponse({
    description: 'Not open, or the Fleet can no longer join.',
  })
  async approve(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @UserId() userId: string,
    @Body() dto: ArmadaSlotDto,
  ): Promise<ArmadaViewDto> {
    await this._featureService.assertEnabled();
    await this._requestService.approve(
      communityId,
      armadaId,
      requestId,
      dto,
      userId,
    );

    return this.viewAfter(communityId, armadaId, userId);
  }

  /**
   * Rejects a request, with a reason.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param requestId - The request.
   * @param userId - Who rejects it.
   * @param dto - Why.
   * @returns The Armada's shape now.
   */
  @Post('armadas/:armadaId/requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ARMADA_MANAGE, ARMADA_SOURCE)
  @ApiOperation({ summary: 'Reject a request to join an Armada' })
  @ApiOkResponse({ type: ArmadaViewDto })
  @ApiBadRequestResponse({ description: 'No reason given.' })
  @ApiConflictResponse({ description: 'Not open.' })
  async reject(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @UserId() userId: string,
    @Body() dto: ArmadaReasonDto,
  ): Promise<ArmadaViewDto> {
    await this._featureService.assertEnabled();
    await this._requestService.reject(
      communityId,
      armadaId,
      requestId,
      dto.reason,
      userId,
    );

    return this.viewAfter(communityId, armadaId, userId);
  }

  /**
   * Moves a placed Fleet.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param fleetId - The Fleet.
   * @param userId - Who moves it.
   * @param dto - Where, why, and what becomes of its Gammas.
   * @returns The Armada's shape now.
   */
  @Post('armadas/:armadaId/placements/:fleetId/move')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ARMADA_MANAGE, ARMADA_SOURCE)
  @ApiOperation({ summary: 'Move a Fleet within an Armada' })
  @ApiOkResponse({ type: ArmadaViewDto })
  @ApiBadRequestResponse({ description: 'No reason, or it does not fit.' })
  @ApiNotFoundResponse({ description: 'The Fleet is not in the Armada.' })
  async move(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() dto: MoveArmadaFleetDto,
  ): Promise<ArmadaViewDto> {
    await this._featureService.assertEnabled();
    await this._arrangeService.move(
      communityId,
      armadaId,
      fleetId,
      dto,
      userId,
    );

    return this.viewAfter(communityId, armadaId, userId);
  }

  /**
   * Takes a Fleet out of an Armada, as its manager.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param fleetId - The Fleet.
   * @param userId - Who removes it.
   * @param dto - Why, and what becomes of its Gammas.
   * @returns The Armada's shape now.
   */
  @Post('armadas/:armadaId/placements/:fleetId/remove')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ARMADA_MANAGE, ARMADA_SOURCE)
  @ApiOperation({ summary: 'Remove a Fleet from an Armada' })
  @ApiOkResponse({ type: ArmadaViewDto })
  @ApiBadRequestResponse({ description: 'No reason, or it does not fit.' })
  @ApiNotFoundResponse({ description: 'The Fleet is not in the Armada.' })
  async remove(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() dto: RemoveArmadaFleetDto,
  ): Promise<ArmadaViewDto> {
    await this._featureService.assertEnabled();
    await this._arrangeService.remove(
      communityId,
      armadaId,
      fleetId,
      dto,
      userId,
    );

    return this.viewAfter(communityId, armadaId, userId);
  }

  /**
   * Reads a Fleet's Armada, for its page.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The reader, or null when signed out.
   * @returns Where it sits, and what its managers may do.
   */
  @Get('fleets/:fleetId/armada')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read a Fleet’s Armada' })
  @ApiOkResponse({ type: FleetArmadaViewDto })
  @ApiNotFoundResponse({ description: 'No such Fleet, or hidden.' })
  async fleetView(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<FleetArmadaViewDto> {
    const fleet = await this.visibleFleet(communityId, fleetId, userId);

    return this._viewService.fleetView(fleet, userId);
  }

  /**
   * Asks for a Fleet to join an Armada.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - Who asks.
   * @param dto - The Armada, and anything to say.
   * @returns The Fleet's Armada now.
   */
  @Post('fleets/:fleetId/armada/requests')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ARMADA_REQUEST, FLEET_SOURCE)
  @ApiOperation({ summary: 'Ask for a Fleet to join an Armada' })
  @ApiOkResponse({ type: FleetArmadaViewDto })
  @ApiBadRequestResponse({ description: 'Another platform or allegiance.' })
  @ApiConflictResponse({
    description: 'Closed, placed already, or a request is open.',
  })
  async request(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() dto: CreateArmadaRequestDto,
  ): Promise<FleetArmadaViewDto> {
    await this._featureService.assertEnabled();
    await this._requestService.request(communityId, fleetId, dto, userId);

    return this.fleetViewAfter(communityId, fleetId, userId);
  }

  /**
   * Withdraws a Fleet's open request.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param requestId - The request.
   * @param userId - Who withdraws it.
   * @returns The Fleet's Armada now.
   */
  @Post('fleets/:fleetId/armada/requests/:requestId/withdraw')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ARMADA_REQUEST, FLEET_SOURCE)
  @ApiOperation({ summary: 'Withdraw a request to join an Armada' })
  @ApiOkResponse({ type: FleetArmadaViewDto })
  @ApiConflictResponse({ description: 'Not open.' })
  async withdraw(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @UserId() userId: string,
  ): Promise<FleetArmadaViewDto> {
    await this._featureService.assertEnabled();
    await this._requestService.withdraw(
      communityId,
      fleetId,
      requestId,
      userId,
    );

    return this.fleetViewAfter(communityId, fleetId, userId);
  }

  /**
   * Takes a Fleet out of its Armada, as its own manager.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - Who takes it out.
   * @param dto - Why.
   * @returns The Fleet's Armada now.
   */
  @Post('fleets/:fleetId/armada/leave')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ARMADA_REQUEST, FLEET_SOURCE)
  @ApiOperation({ summary: 'Take a Fleet out of its Armada' })
  @ApiOkResponse({ type: FleetArmadaViewDto })
  @ApiBadRequestResponse({ description: 'No reason given.' })
  @ApiConflictResponse({ description: 'A Beta with Gammas under it.' })
  async leave(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() dto: ArmadaReasonDto,
  ): Promise<FleetArmadaViewDto> {
    await this._featureService.assertEnabled();
    await this._arrangeService.leave(communityId, fleetId, dto, userId);

    return this.fleetViewAfter(communityId, fleetId, userId);
  }

  /**
   * Finds an Armada the reader may see: one in a Community they may see.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param userId - The reader, or null when signed out.
   * @returns The Armada.
   * @throws NotFoundException when there is none, or it is hidden.
   */
  private async visibleArmada(
    communityId: string,
    armadaId: string,
    userId: string | null,
  ): Promise<StoArmadaEntity> {
    await this._featureService.assertEnabled();

    const armada = await this._armadaService.findByIdOrFail(
      communityId,
      armadaId,
    );

    await this._audienceService.assertCanView(
      armada.community.visibility,
      { kind: FleetScopeKind.COMMUNITY, id: armada.communityId },
      userId,
    );

    return armada;
  }

  /**
   * Finds a Fleet the reader may see.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The reader, or null when signed out.
   * @returns The Fleet.
   * @throws NotFoundException when there is none, or it is hidden.
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

  /**
   * Reads an Armada's shape after a change, for its manager.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param userId - The manager.
   * @returns Its shape now.
   */
  private async viewAfter(
    communityId: string,
    armadaId: string,
    userId: string,
  ): Promise<ArmadaViewDto> {
    return this._viewService.view(
      await this._armadaService.findByIdOrFail(communityId, armadaId),
      userId,
    );
  }

  /**
   * Reads a Fleet's Armada after a change, for its manager.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The manager.
   * @returns Its Armada now.
   */
  private async fleetViewAfter(
    communityId: string,
    fleetId: string,
    userId: string,
  ): Promise<FleetArmadaViewDto> {
    return this._viewService.fleetView(
      await this._fleetService.findByIdOrFail(communityId, fleetId),
      userId,
    );
  }
}
