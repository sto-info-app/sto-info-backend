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
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { PaginatedQueryDto } from 'src/shared/dto/paginated-query.dto';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetFeatureService } from '../fleet-feature.service';
import { CommunityDisputeDto } from './dto/dispute-registrations.dto';
import {
  FleetInvestigationDto,
  FleetInvestigationPageDto,
  FleetInvestigationRequestDto,
} from './dto/fleet-investigation.dto';
import { ReassignOwnershipDto } from './dto/ownership-transfer.dto';
import { GovernanceReasonDto } from './dto/scope-governance.dto';
import { DisputeRegistrationsService } from './services/dispute-registrations.service';
import { FleetInvestigationService } from './services/fleet-investigation.service';
import { OwnershipTransferService } from './services/ownership-transfer.service';
import { ScopeClosureService } from './services/scope-closure.service';
import { ScopeSuspensionService } from './services/scope-suspension.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from './utilities/governance-scope.utility';

/**
 * A site administrator's dispute actions on a Community (FC-022, FC-036).
 *
 * For an Owner who has vanished or a Community that has been reported:
 * ownership moves to one of its Admins with no acceptance; the Community, or
 * one of its Fleets or Armadas, is suspended, reinstated or closed. Each
 * needs a reason and is logged as a site administrator's. The dispute view
 * shows every registration of its Fleets' and Armadas' names, private ones
 * included, with where each came from.
 *
 * Nothing here grants a scoped capability but one: looking into a Fleet's
 * imports, read-only, for 24 hours under a logged purpose.
 */
@ApiTags('Fleet governance (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/fleet-communities/:communityId')
export class AdminFleetGovernanceController {
  /**
   * Creates an instance of AdminFleetGovernanceController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _transfers - Moves ownership.
   * @param _closure - Closes.
   * @param _suspension - Suspends and reinstates (FC-036).
   * @param _registrations - Finds competing registrations (FC-036).
   * @param _investigations - Opens a look into a Fleet (FC-036).
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _transfers: OwnershipTransferService,
    private readonly _closure: ScopeClosureService,
    private readonly _suspension: ScopeSuspensionService,
    private readonly _registrations: DisputeRegistrationsService,
    private readonly _investigations: FleetInvestigationService,
  ) {}

  /**
   * Reads what a dispute action needs.
   *
   * @param communityId - The Community.
   * @returns Its Owner, its Admins, any open offer, and its Fleets and
   *   Armadas with every other registration of their names.
   */
  @Get('dispute')
  @ApiOperation({ summary: 'Read a Community for a dispute action (admin)' })
  @ApiOkResponse({ type: CommunityDisputeDto })
  @ApiForbiddenResponse({ description: 'Not a site administrator.' })
  async dispute(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<CommunityDisputeDto> {
    await this._featureService.assertEnabled();

    return {
      ...(await this._transfers.disputeView(communityId)),
      scopes: await this._registrations.scopesOf(communityId),
    };
  }

  /**
   * Moves ownership to one of the Community's Admins.
   *
   * @param communityId - The Community.
   * @param dto - Who, and why.
   * @param userId - The site administrator.
   */
  @Post('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Move a Community’s ownership (admin)' })
  @ApiNoContentResponse({ description: 'Moved.' })
  @ApiBadRequestResponse({ description: 'No reason, or not an Admin.' })
  async reassign(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: ReassignOwnershipDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._transfers.reassign(
      communityId,
      dto.toUserId,
      dto.reason,
      userId,
    );
  }

  /**
   * Closes the Community.
   *
   * @param communityId - The Community.
   * @param dto - Why.
   * @param userId - The site administrator.
   */
  @Post('close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close a Community (admin)' })
  @ApiNoContentResponse({ description: 'Closed.' })
  async close(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._closure.closeCommunity(communityId, {
      reason: dto.reason,
      actorUserId: userId,
      asSiteAdmin: true,
    });
  }

  /**
   * Suspends the Community, and so everything in it (FC-036).
   *
   * @param communityId - The Community.
   * @param dto - Why.
   * @param userId - The site administrator.
   */
  @Post('suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Suspend a Community (admin)' })
  @ApiNoContentResponse({ description: 'Suspended.' })
  @ApiConflictResponse({ description: 'It is closed.' })
  async suspend(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._suspension.suspend(
      communityScope(communityId),
      dto.reason,
      userId,
    );
  }

  /**
   * Lifts the Community's suspension (FC-036).
   *
   * @param communityId - The Community.
   * @param dto - Why.
   * @param userId - The site administrator.
   */
  @Post('reinstate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reinstate a Community (admin)' })
  @ApiNoContentResponse({ description: 'Reinstated.' })
  @ApiConflictResponse({ description: 'It is closed.' })
  async reinstate(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._suspension.reinstate(
      communityScope(communityId),
      dto.reason,
      userId,
    );
  }

  /**
   * Suspends one of the Community's Fleets (FC-036).
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param dto - Why.
   * @param userId - The site administrator.
   */
  @Post('fleets/:fleetId/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Suspend a Fleet (admin)' })
  @ApiNoContentResponse({ description: 'Suspended.' })
  async suspendFleet(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._suspension.suspend(
      fleetScope(communityId, fleetId),
      dto.reason,
      userId,
    );
  }

  /**
   * Lifts a Fleet's suspension (FC-036).
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param dto - Why.
   * @param userId - The site administrator.
   */
  @Post('fleets/:fleetId/reinstate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reinstate a Fleet (admin)' })
  @ApiNoContentResponse({ description: 'Reinstated.' })
  async reinstateFleet(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._suspension.reinstate(
      fleetScope(communityId, fleetId),
      dto.reason,
      userId,
    );
  }

  /**
   * Closes one of the Community's Fleets (FC-036).
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param dto - Why.
   * @param userId - The site administrator.
   */
  @Post('fleets/:fleetId/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close a Fleet (admin)' })
  @ApiNoContentResponse({ description: 'Closed.' })
  async closeFleet(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._closure.closeFleet(communityId, fleetId, {
      reason: dto.reason,
      actorUserId: userId,
      asSiteAdmin: true,
    });
  }

  /**
   * Suspends one of the Community's Armadas (FC-036).
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param dto - Why.
   * @param userId - The site administrator.
   */
  @Post('armadas/:armadaId/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Suspend an Armada (admin)' })
  @ApiNoContentResponse({ description: 'Suspended.' })
  async suspendArmada(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._suspension.suspend(
      armadaScope(communityId, armadaId),
      dto.reason,
      userId,
    );
  }

  /**
   * Lifts an Armada's suspension (FC-036).
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param dto - Why.
   * @param userId - The site administrator.
   */
  @Post('armadas/:armadaId/reinstate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reinstate an Armada (admin)' })
  @ApiNoContentResponse({ description: 'Reinstated.' })
  async reinstateArmada(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._suspension.reinstate(
      armadaScope(communityId, armadaId),
      dto.reason,
      userId,
    );
  }

  /**
   * Closes one of the Community's Armadas (FC-036).
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param dto - Why.
   * @param userId - The site administrator.
   */
  @Post('armadas/:armadaId/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close an Armada (admin)' })
  @ApiNoContentResponse({ description: 'Closed.' })
  async closeArmada(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._closure.closeArmadaAsSiteAdmin(communityId, armadaId, {
      reason: dto.reason,
      actorUserId: userId,
    });
  }

  /**
   * Opens a read-only look into a Fleet's imports, for 24 hours (FC-036).
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param dto - Why.
   * @param userId - The site administrator.
   * @returns The look.
   */
  @Post('fleets/:fleetId/investigations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Look into a Fleet’s imports (admin)' })
  @ApiOkResponse({ type: FleetInvestigationDto })
  async investigate(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Body() dto: FleetInvestigationRequestDto,
    @UserId() userId: string,
  ): Promise<FleetInvestigationDto> {
    await this._featureService.assertEnabled();

    return this._investigations.open(communityId, fleetId, userId, dto.purpose);
  }
}

/**
 * The record of site admins' looks into Fleets (FC-036): the caller's open
 * ones, and everybody's, newest first.
 */
@ApiTags('Fleet governance (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/fleet-investigations')
export class AdminFleetInvestigationsController {
  /**
   * Creates an instance of AdminFleetInvestigationsController.
   *
   * @param _investigations - The looks.
   */
  constructor(private readonly _investigations: FleetInvestigationService) {}

  /**
   * Lists the caller's open looks.
   *
   * @param userId - The site administrator.
   * @returns Each, soonest to end first.
   */
  @Get('mine')
  @ApiOperation({ summary: 'List your open looks into Fleets (admin)' })
  @ApiOkResponse({ type: [FleetInvestigationDto] })
  mine(@UserId() userId: string): Promise<FleetInvestigationDto[]> {
    return this._investigations.mine(userId);
  }

  /**
   * Lists every look, newest first.
   *
   * @param query - Which page.
   * @returns The page.
   */
  @Get()
  @ApiOperation({ summary: 'List site admins’ looks into Fleets (admin)' })
  @ApiOkResponse({ type: FleetInvestigationPageDto })
  log(@Query() query: PaginatedQueryDto): Promise<FleetInvestigationPageDto> {
    return this._investigations.log(query.page, query.pageSize);
  }
}
