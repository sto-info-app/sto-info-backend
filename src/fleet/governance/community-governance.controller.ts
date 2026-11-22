import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  OfferOwnershipDto,
  OwnershipStandingDto,
  OwnershipTransferDto,
} from './dto/ownership-transfer.dto';
import {
  AssignScopeRoleDto,
  GovernanceReasonDto,
  OptionalGovernanceReasonDto,
  ScopeGovernanceActionDto,
  ScopeRolesDto,
  SetOfficerCapabilitiesDto,
  SetPersonalCapabilityDto,
} from './dto/scope-governance.dto';
import { OwnershipTransferService } from './services/ownership-transfer.service';
import { ScopeClosureService } from './services/scope-closure.service';
import { ScopeGovernanceLogService } from './services/scope-governance-log.service';
import { ScopeRolesService } from './services/scope-roles.service';
import { communityScope } from './utilities/governance-scope.utility';

/** Where every guarded route here finds its Community. */
const COMMUNITY_SOURCE = {
  kind: FleetScopeKind.COMMUNITY,
  param: 'communityId',
} as const;

/**
 * Who governs a Community: its roles, delegations, ownership and closure
 * (FC-022).
 *
 * Changing roles and delegations needs `scope.roles.manage`, offering or
 * cancelling ownership `scope.ownership.transfer`, and closing `scope.close`.
 * All three are the Owner's and none can be delegated. Reading needs the
 * Owner or an Admin, which the service checks. Accepting or declining an
 * offer needs only to be the Admin it was made to.
 */
@ApiTags('Fleet governance')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/governance')
export class CommunityGovernanceController {
  /**
   * Creates an instance of CommunityGovernanceController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _roles - Roles and delegations.
   * @param _transfers - Ownership offers.
   * @param _closure - Closure.
   * @param _log - The history.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _roles: ScopeRolesService,
    private readonly _transfers: OwnershipTransferService,
    private readonly _closure: ScopeClosureService,
    private readonly _log: ScopeGovernanceLogService,
  ) {}

  /**
   * Reads who governs the Community.
   *
   * @param communityId - The Community.
   * @param userId - The reader.
   * @returns The Owner, role holders and delegations.
   */
  @Get('roles')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Read who governs a Community' })
  @ApiOkResponse({ type: ScopeRolesDto })
  @ApiForbiddenResponse({ description: 'Neither the Owner nor an Admin.' })
  async roles(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @UserId() userId: string,
  ): Promise<ScopeRolesDto> {
    await this._featureService.assertEnabled();

    return this._roles.view(communityScope(communityId), userId);
  }

  /**
   * Gives somebody a role at the Community.
   *
   * @param communityId - The Community.
   * @param dto - Who, which role, and optionally why.
   * @param userId - The Owner.
   */
  @Post('roles')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(
    FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
    COMMUNITY_SOURCE,
  )
  @ApiOperation({ summary: 'Appoint an Admin or Officer in a Community' })
  @ApiNoContentResponse({ description: 'Appointed.' })
  @ApiBadRequestResponse({ description: 'Not eligible.' })
  @ApiConflictResponse({ description: 'They hold a role here already.' })
  async assign(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: AssignScopeRoleDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.assign(communityScope(communityId), dto, userId);
  }

  /**
   * Takes a role away, with a reason.
   *
   * @param communityId - The Community.
   * @param assignmentId - The assignment.
   * @param dto - Why.
   * @param userId - The Owner.
   */
  @Post('roles/:assignmentId/withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(
    FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
    COMMUNITY_SOURCE,
  )
  @ApiOperation({ summary: 'Withdraw a role in a Community' })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiNotFoundResponse({ description: 'No such held role here.' })
  async withdraw(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.withdraw(
      communityScope(communityId),
      assignmentId,
      dto.reason,
      userId,
    );
  }

  /**
   * Sets what every Officer in the Community holds.
   *
   * @param communityId - The Community.
   * @param dto - The capabilities, and why.
   * @param userId - The Owner.
   */
  @Put('officer-capabilities')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(
    FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
    COMMUNITY_SOURCE,
  )
  @ApiOperation({ summary: 'Set what Officers hold in a Community' })
  @ApiNoContentResponse({ description: 'Saved.' })
  async setOfficerCapabilities(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: SetOfficerCapabilitiesDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.setOfficerCapabilities(
      communityScope(communityId),
      dto,
      userId,
    );
  }

  /**
   * Grants or denies one capability to one person in the Community.
   *
   * @param communityId - The Community.
   * @param dto - Who, what, which way, and why.
   * @param userId - The Owner.
   */
  @Put('personal-capabilities')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(
    FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
    COMMUNITY_SOURCE,
  )
  @ApiOperation({ summary: 'Grant or deny a capability to one person' })
  @ApiNoContentResponse({ description: 'Saved.' })
  async setPersonal(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: SetPersonalCapabilityDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.setPersonal(communityScope(communityId), dto, userId);
  }

  /**
   * Clears one person's grant or denial.
   *
   * @param communityId - The Community.
   * @param grantId - The grant or denial.
   * @param dto - Why, required when a grant is cleared.
   * @param userId - The Owner.
   */
  @Post('personal-capabilities/:grantId/clear')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(
    FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
    COMMUNITY_SOURCE,
  )
  @ApiOperation({ summary: 'Clear one person’s grant or denial' })
  @ApiNoContentResponse({ description: 'Cleared.' })
  async clearPersonal(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: OptionalGovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.clearPersonal(
      communityScope(communityId),
      grantId,
      dto.reason,
      userId,
    );
  }

  /**
   * Reads the Community's recent governance history.
   *
   * @param communityId - The Community.
   * @param userId - The reader.
   * @returns The newest changes first.
   */
  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Read a Community’s governance history' })
  @ApiOkResponse({ type: [ScopeGovernanceActionDto] })
  async history(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @UserId() userId: string,
  ): Promise<ScopeGovernanceActionDto[]> {
    await this._featureService.assertEnabled();

    const scope = communityScope(communityId);

    await this._roles.assertMayRead(scope, userId);

    return this._log.list(scope);
  }

  /**
   * Reads where ownership stands, for the Owner or the Admin offered it.
   *
   * @param communityId - The Community.
   * @param userId - The reader.
   * @returns The open offer, and whom the Owner may offer it to.
   */
  @Get('ownership')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Read where a Community’s ownership stands' })
  @ApiOkResponse({ type: OwnershipStandingDto })
  async ownership(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @UserId() userId: string,
  ): Promise<OwnershipStandingDto> {
    await this._featureService.assertEnabled();

    return this._transfers.standing(communityId, userId);
  }

  /**
   * Offers the Community to one of its Admins.
   *
   * @param communityId - The Community.
   * @param dto - The Admin.
   * @param userId - The Owner.
   * @returns The offer.
   */
  @Post('ownership')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(
    FLEET_CAPABILITIES.SCOPE_OWNERSHIP_TRANSFER,
    COMMUNITY_SOURCE,
  )
  @ApiOperation({ summary: 'Offer a Community to one of its Admins' })
  @ApiCreatedResponse({ type: OwnershipTransferDto })
  @ApiConflictResponse({ description: 'An offer is already open.' })
  async offer(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: OfferOwnershipDto,
    @UserId() userId: string,
  ): Promise<OwnershipTransferDto> {
    await this._featureService.assertEnabled();

    return this._transfers.offer(communityId, dto.toUserId, userId);
  }

  /**
   * Takes an open offer back.
   *
   * @param communityId - The Community.
   * @param transferId - The offer.
   * @param userId - The Owner.
   */
  @Post('ownership/:transferId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(
    FLEET_CAPABILITIES.SCOPE_OWNERSHIP_TRANSFER,
    COMMUNITY_SOURCE,
  )
  @ApiOperation({ summary: 'Cancel an ownership offer' })
  @ApiNoContentResponse({ description: 'Cancelled.' })
  async cancel(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._transfers.cancel(communityId, transferId, userId);
  }

  /**
   * Accepts an offer made to the caller.
   *
   * @param communityId - The Community.
   * @param transferId - The offer.
   * @param userId - The Admin offered it.
   */
  @Post('ownership/:transferId/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Accept an ownership offer' })
  @ApiNoContentResponse({ description: 'They are now the Owner.' })
  @ApiConflictResponse({
    description: 'It expired, was answered, or can no longer be kept.',
  })
  async accept(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._transfers.accept(communityId, transferId, userId);
  }

  /**
   * Declines an offer made to the caller.
   *
   * @param communityId - The Community.
   * @param transferId - The offer.
   * @param userId - The Admin offered it.
   */
  @Post('ownership/:transferId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Decline an ownership offer' })
  @ApiNoContentResponse({ description: 'Declined.' })
  async decline(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._transfers.decline(communityId, transferId, userId);
  }

  /**
   * Closes the Community, with a reason.
   *
   * @param communityId - The Community.
   * @param dto - Why.
   * @param userId - The Owner.
   */
  @Post('close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_CLOSE, COMMUNITY_SOURCE)
  @ApiOperation({
    summary: 'Close a Fleet Community',
    description:
      'Closure is a status change, not a deletion. The Community stays ' +
      'readable, keeps its web address, and accepts nothing new; every role ' +
      'and grant held at it ends.',
  })
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
    });
  }
}
