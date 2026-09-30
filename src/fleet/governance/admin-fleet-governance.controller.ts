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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { CallerRole } from 'src/auth/user-role.decorator';
import {
  PaginatedQueryDto,
  SearchPaginatedQueryDto,
} from 'src/shared/dto/paginated-query.dto';
import { UserRole } from 'src/user/enums/user-role.enum';

import { ResolvedFleetCommunityDto } from '../dto/fleet-community.dto';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { FleetCommunityMapper } from '../mappers/fleet-community.mapper';
import { FleetCommunityService } from '../services/fleet-community.service';
import { FleetScopeViewerService } from '../services/fleet-scope-viewer.service';
import { AdminCommunityPageDto } from './dto/admin-community-search.dto';
import { CommunityDisputeDto } from './dto/dispute-registrations.dto';
import {
  FleetInvestigationDto,
  FleetInvestigationPageDto,
  FleetInvestigationRequestDto,
} from './dto/fleet-investigation.dto';
import { ReassignOwnershipDto } from './dto/ownership-transfer.dto';
import { GovernanceReasonDto } from './dto/scope-governance.dto';
import { AdminCommunitySearchService } from './services/admin-community-search.service';
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
 * Finds Communities by name for a site administrator's dispute page, whoever
 * may see them (FC-050).
 *
 * The Admin area's way in: a members-only or private Community is on no
 * directory and its own page is closed to a site administrator who is not in
 * it, so without this the dispute page is reached only by typing its address.
 */
@ApiTags('Fleet governance (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/fleet-communities')
export class AdminFleetCommunitySearchController {
  /**
   * Creates an instance of AdminFleetCommunitySearchController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _search - Finds the Communities.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _search: AdminCommunitySearchService,
  ) {}

  /**
   * Lists live Communities by name, whoever may see them.
   *
   * @param query - What to look for in a name or web address, and which page.
   * @returns The page, by name.
   */
  @Get()
  @ApiOperation({ summary: 'Find any Fleet Community by name (admin)' })
  @ApiOkResponse({ type: AdminCommunityPageDto })
  @ApiForbiddenResponse({ description: 'Not a site administrator.' })
  async search(
    @Query() query: SearchPaginatedQueryDto,
  ): Promise<AdminCommunityPageDto> {
    await this._featureService.assertEnabled();

    return this._search.search(query.search, query.page, query.pageSize);
  }
}

/**
 * Finds a Community from its web address for a site administrator's dispute
 * page, whoever may see it (FC-050).
 *
 * Steve's decision of 30 September 2026: a site administrator reaches every
 * Community's dispute page, members-only and private ones included. The
 * public `GET /fleet-communities/by-slug/:slug` still answers them as it
 * answers anybody, so this is the only read that skips the audience check,
 * and only a site administrator reaches it. It says nothing the dispute view
 * does not already.
 *
 * Its routes are registered before {@link AdminFleetGovernanceController}'s,
 * whose `:communityId` would otherwise take `by-slug` for an identifier when
 * a Community's slug is `dispute`.
 */
@ApiTags('Fleet governance (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/fleet-communities/by-slug')
export class AdminFleetCommunityLookupController {
  /**
   * Creates an instance of AdminFleetCommunityLookupController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _communityService - Resolves the Community segment.
   * @param _viewerService - Answers what the caller may do there.
   * @param _mapper - Turns a Community into its API shape.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _communityService: FleetCommunityService,
    private readonly _viewerService: FleetScopeViewerService,
    private readonly _mapper: FleetCommunityMapper,
  ) {}

  /**
   * Resolves a Community from its URL segment, following a rename, whoever
   * may see it.
   *
   * @param slug - The segment from the URL.
   * @param userId - The site administrator.
   * @param role - Their site-wide role.
   * @returns The Community, and the retired segment when one was used.
   */
  @Get(':slug')
  @ApiOperation({
    summary: 'Resolve any Fleet Community by its URL segment (admin)',
  })
  @ApiOkResponse({ type: ResolvedFleetCommunityDto })
  @ApiForbiddenResponse({ description: 'Not a site administrator.' })
  @ApiNotFoundResponse({
    description: 'No Community answers to that segment, now or in the past.',
  })
  async resolveBySlug(
    @Param('slug') slug: string,
    @UserId() userId: string,
    @CallerRole() role: UserRole | null,
  ): Promise<ResolvedFleetCommunityDto> {
    await this._featureService.assertEnabled();

    const resolved = await this._communityService.resolveBySlugOrFail(slug);

    return {
      community: this._mapper.toDto(resolved.community),
      redirectedFrom: resolved.redirectedFrom,
      viewer: await this._viewerService.forScope(
        { userId, role },
        { kind: FleetScopeKind.COMMUNITY, id: resolved.community.id },
      ),
    };
  }
}

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
 *
 * None of these routes asks whether the site administrator may see the
 * Community: they work at a members-only or private one as at a public one
 * (Steve's decision of 30 September 2026), behind the site role alone.
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
    await this._closure.closeArmada(communityId, armadaId, {
      reason: dto.reason,
      actorUserId: userId,
      asSiteAdmin: true,
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
