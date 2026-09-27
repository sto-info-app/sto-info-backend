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
  AssignScopeRoleDto,
  GovernanceReasonDto,
  OptionalGovernanceReasonDto,
  ScopeGovernanceActionDto,
  ScopeRolesDto,
  SetOfficerCapabilitiesDto,
  SetPersonalCapabilityDto,
} from './dto/scope-governance.dto';
import { ScopeClosureService } from './services/scope-closure.service';
import { ScopeGovernanceLogService } from './services/scope-governance-log.service';
import { ScopeRolesService } from './services/scope-roles.service';
import { fleetScope } from './utilities/governance-scope.utility';

/** Where every guarded route here finds its Fleet. */
const FLEET_SOURCE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
} as const;

/**
 * Who governs a Fleet: its roles, delegations and closure (FC-022).
 *
 * The same rules as a Community's, at one Fleet. A Fleet has no Owner of its
 * own: its Community's Owner is its Owner, and a Fleet's leader is appointed
 * Admin here.
 */
@ApiTags('Fleet governance')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/fleets/:fleetId/governance')
export class FleetGovernanceController {
  /**
   * Creates an instance of FleetGovernanceController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _roles - Roles and delegations.
   * @param _closure - Closure.
   * @param _log - The history.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _roles: ScopeRolesService,
    private readonly _closure: ScopeClosureService,
    private readonly _log: ScopeGovernanceLogService,
  ) {}

  /**
   * Reads who governs the Fleet.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The reader.
   * @returns The Owner, role holders and delegations.
   */
  @Get('roles')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Read who governs a Fleet' })
  @ApiOkResponse({ type: ScopeRolesDto })
  @ApiForbiddenResponse({ description: 'Neither the Owner nor an Admin.' })
  async roles(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
  ): Promise<ScopeRolesDto> {
    await this._featureService.assertEnabled();

    return this._roles.view(fleetScope(communityId, fleetId), userId);
  }

  /**
   * Gives somebody a role at the Fleet.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param dto - Who, which role, and optionally why.
   * @param userId - The Owner.
   */
  @Post('roles')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Appoint an Admin or Officer in a Fleet' })
  @ApiNoContentResponse({ description: 'Appointed.' })
  @ApiBadRequestResponse({ description: 'Not eligible.' })
  @ApiConflictResponse({ description: 'They hold a role here already.' })
  async assign(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Body() dto: AssignScopeRoleDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.assign(fleetScope(communityId, fleetId), dto, userId);
  }

  /**
   * Takes a role away, with a reason.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param assignmentId - The assignment.
   * @param dto - Why.
   * @param userId - The Owner.
   */
  @Post('roles/:assignmentId/withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Withdraw a role in a Fleet' })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiNotFoundResponse({ description: 'No such held role here.' })
  async withdraw(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.withdraw(
      fleetScope(communityId, fleetId),
      assignmentId,
      dto.reason,
      userId,
    );
  }

  /**
   * Sets what every Officer in the Fleet holds.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param dto - The capabilities, and why.
   * @param userId - The Owner.
   */
  @Put('officer-capabilities')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Set what Officers hold in a Fleet' })
  @ApiNoContentResponse({ description: 'Saved.' })
  async setOfficerCapabilities(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Body() dto: SetOfficerCapabilitiesDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.setOfficerCapabilities(
      fleetScope(communityId, fleetId),
      dto,
      userId,
    );
  }

  /**
   * Grants or denies one capability to one person in the Fleet.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param dto - Who, what, which way, and why.
   * @param userId - The Owner.
   */
  @Put('personal-capabilities')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Grant or deny a capability to one person' })
  @ApiNoContentResponse({ description: 'Saved.' })
  async setPersonal(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Body() dto: SetPersonalCapabilityDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.setPersonal(
      fleetScope(communityId, fleetId),
      dto,
      userId,
    );
  }

  /**
   * Clears one person's grant or denial.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param grantId - The grant or denial.
   * @param dto - Why, required when a grant is cleared.
   * @param userId - The Owner.
   */
  @Post('personal-capabilities/:grantId/clear')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Clear one person’s grant or denial' })
  @ApiNoContentResponse({ description: 'Cleared.' })
  async clearPersonal(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: OptionalGovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.clearPersonal(
      fleetScope(communityId, fleetId),
      grantId,
      dto.reason,
      userId,
    );
  }

  /**
   * Reads the Fleet's recent governance history.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The reader.
   * @returns The newest changes first.
   */
  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Read a Fleet’s governance history' })
  @ApiOkResponse({ type: [ScopeGovernanceActionDto] })
  async history(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
  ): Promise<ScopeGovernanceActionDto[]> {
    await this._featureService.assertEnabled();

    const scope = fleetScope(communityId, fleetId);

    await this._roles.assertMayRead(scope, userId);

    return this._log.list(scope);
  }

  /**
   * Closes the Fleet, with a reason.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param dto - Why.
   * @param userId - The Owner.
   */
  @Post('close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_CLOSE, FLEET_SOURCE)
  @ApiOperation({
    summary: 'Close a Fleet',
    description:
      'Closure is a status change, not a deletion. The Fleet stays ' +
      'readable, keeps its Armada placements, roster history and web ' +
      'address, and accepts nothing new; every role and grant held at it ' +
      'ends.',
  })
  @ApiNoContentResponse({ description: 'Closed.' })
  async close(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._closure.closeFleet(communityId, fleetId, {
      reason: dto.reason,
      actorUserId: userId,
    });
  }
}
