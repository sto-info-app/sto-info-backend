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
import { armadaScope } from './utilities/governance-scope.utility';

/** Where every guarded route here finds its Armada. */
const ARMADA_SOURCE = {
  kind: FleetScopeKind.ARMADA,
  param: 'armadaId',
  communityParam: 'communityId',
} as const;

/**
 * Who governs an Armada: its roles and delegations (FC-025).
 *
 * The same rules as a Fleet's, at one Armada. Its Community's Owner is its
 * Owner, and appoints its Admins and Officers from the approved members of
 * the Fleets placed in it; a role ends when its holder's Fleet leaves. Its
 * Owner closes it here with a reason, as a Fleet's closes a Fleet (FC-050);
 * the closure ends its placements.
 */
@ApiTags('Armada governance')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/armadas/:armadaId/governance')
export class ArmadaGovernanceController {
  /**
   * Creates an instance of ArmadaGovernanceController.
   *
   * @param _featureService - Reports whether the Armada feature is on.
   * @param _roles - Roles and delegations.
   * @param _log - The history.
   * @param _closure - Closes it (FC-050).
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _roles: ScopeRolesService,
    private readonly _log: ScopeGovernanceLogService,
    private readonly _closure: ScopeClosureService,
  ) {}

  /**
   * Reads who governs the Armada.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param userId - The reader.
   * @returns The Owner, role holders and delegations.
   */
  @Get('roles')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Read who governs an Armada' })
  @ApiOkResponse({ type: ScopeRolesDto })
  @ApiForbiddenResponse({ description: 'Neither the Owner nor an Admin.' })
  async roles(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @UserId() userId: string,
  ): Promise<ScopeRolesDto> {
    await this._featureService.assertEnabled();

    return this._roles.view(armadaScope(communityId, armadaId), userId);
  }

  /**
   * Gives somebody a role at the Armada.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param dto - Who, which role, and optionally why.
   * @param userId - The Owner.
   */
  @Post('roles')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE, ARMADA_SOURCE)
  @ApiOperation({ summary: 'Appoint an Admin or Officer in an Armada' })
  @ApiNoContentResponse({ description: 'Appointed.' })
  @ApiBadRequestResponse({ description: 'Not eligible.' })
  @ApiConflictResponse({ description: 'They hold a role here already.' })
  async assign(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Body() dto: AssignScopeRoleDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.assign(armadaScope(communityId, armadaId), dto, userId);
  }

  /**
   * Takes a role away, with a reason.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param assignmentId - The assignment.
   * @param dto - Why.
   * @param userId - The Owner.
   */
  @Post('roles/:assignmentId/withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE, ARMADA_SOURCE)
  @ApiOperation({ summary: 'Withdraw a role in an Armada' })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiNotFoundResponse({ description: 'No such held role here.' })
  async withdraw(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.withdraw(
      armadaScope(communityId, armadaId),
      assignmentId,
      dto.reason,
      userId,
    );
  }

  /**
   * Sets what every Officer in the Armada holds.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param dto - The capabilities, and why.
   * @param userId - The Owner.
   */
  @Put('officer-capabilities')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE, ARMADA_SOURCE)
  @ApiOperation({ summary: 'Set what Officers hold in an Armada' })
  @ApiNoContentResponse({ description: 'Saved.' })
  async setOfficerCapabilities(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Body() dto: SetOfficerCapabilitiesDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.setOfficerCapabilities(
      armadaScope(communityId, armadaId),
      dto,
      userId,
    );
  }

  /**
   * Grants or denies one capability to one person in the Armada.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param dto - Who, what, which way, and why.
   * @param userId - The Owner.
   */
  @Put('personal-capabilities')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE, ARMADA_SOURCE)
  @ApiOperation({ summary: 'Grant or deny a capability to one person' })
  @ApiNoContentResponse({ description: 'Saved.' })
  async setPersonal(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Body() dto: SetPersonalCapabilityDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.setPersonal(
      armadaScope(communityId, armadaId),
      dto,
      userId,
    );
  }

  /**
   * Clears one person's grant or denial.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param grantId - The grant or denial.
   * @param dto - Why, required when a grant is cleared.
   * @param userId - The Owner.
   */
  @Post('personal-capabilities/:grantId/clear')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE, ARMADA_SOURCE)
  @ApiOperation({ summary: 'Clear one person’s grant or denial' })
  @ApiNoContentResponse({ description: 'Cleared.' })
  async clearPersonal(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: OptionalGovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._roles.clearPersonal(
      armadaScope(communityId, armadaId),
      grantId,
      dto.reason,
      userId,
    );
  }

  /**
   * Reads the Armada's recent governance history.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param userId - The reader.
   * @returns The newest changes first.
   */
  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Read an Armada’s governance history' })
  @ApiOkResponse({ type: [ScopeGovernanceActionDto] })
  async history(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @UserId() userId: string,
  ): Promise<ScopeGovernanceActionDto[]> {
    await this._featureService.assertEnabled();

    const scope = armadaScope(communityId, armadaId);

    await this._roles.assertMayRead(scope, userId);

    return this._log.list(scope);
  }

  /**
   * Closes the Armada, with a reason (FC-050).
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param dto - Why.
   * @param userId - The Owner.
   */
  @Post('close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_CLOSE, ARMADA_SOURCE)
  @ApiOperation({
    summary: 'Close an Armada',
    description:
      'Closure is a status change, not a deletion. Which Fleets were in it ' +
      'and when stays readable; every placement, request, role and grant ' +
      'there ends.',
  })
  @ApiNoContentResponse({ description: 'Closed.' })
  async close(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._closure.closeArmada(communityId, armadaId, {
      reason: dto.reason,
      actorUserId: userId,
    });
  }
}
