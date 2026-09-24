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
  ApiBearerAuth,
  ApiConflictResponse,
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
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { DecideRosterIdentityCandidateDto } from './dto/decide-roster-identity-candidate.dto';
import { RosterIdentityCandidateQueryDto } from './dto/roster-identity-candidate-query.dto';
import {
  RosterIdentityCandidateDto,
  RosterIdentityCandidatePageDto,
} from './dto/roster-identity-candidate.dto';
import { RosterIdentityReviewService } from './services/roster-identity-review.service';

/** Where a Fleet's scope is found in these routes. */
const FLEET_SCOPE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
} as const;

/**
 * A Fleet's rename candidates, for the people who investigate its roster.
 *
 * `roster.investigate` for reading as well as deciding, because a candidate
 * names Characters and account handles as the roster exported them, and
 * that capability's description already includes identity conflicts. Owners
 * and Admins hold it; it can be delegated. Steve's decision of 24 September
 * 2026. A caller who cannot see the Fleet at all is told it does not exist,
 * by the guard, as on every other scoped route.
 *
 * Behind the same switch as imports: with imports off there is no evidence
 * a candidate could rest on.
 */
@ApiTags('Fleet')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/fleets/:fleetId/roster-identities')
export class RosterIdentitiesController {
  /**
   * Creates an instance of RosterIdentitiesController.
   *
   * @param _reviewService - Reads and decides rename candidates.
   * @param _featureService - Reports whether imports are switched on.
   */
  constructor(
    private readonly _reviewService: RosterIdentityReviewService,
    private readonly _featureService: FleetFeatureService,
  ) {}

  /**
   * Lists a Fleet's rename candidates, open ones first.
   *
   * @param fleetId - The Fleet.
   * @param query - Which page, and which state.
   * @returns The page.
   */
  @Get('candidates')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_INVESTIGATE, FLEET_SCOPE)
  @ApiOperation({ summary: "List this Fleet's rename candidates" })
  @ApiOkResponse({ type: RosterIdentityCandidatePageDto })
  async list(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: RosterIdentityCandidateQueryDto,
  ): Promise<RosterIdentityCandidatePageDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    return this._reviewService.list(fleetId, query);
  }

  /**
   * Confirms, rejects or undoes a rename candidate.
   *
   * @param fleetId - The Fleet.
   * @param candidateId - The candidate.
   * @param userId - The reviewer.
   * @param body - What they decided, the revision they saw and why.
   * @returns The candidate as it now stands.
   */
  @Post('candidates/:candidateId/decisions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_INVESTIGATE, FLEET_SCOPE)
  @ApiOperation({ summary: 'Confirm, reject or undo a rename candidate' })
  @ApiOkResponse({ type: RosterIdentityCandidateDto })
  @ApiNotFoundResponse({
    description:
      'The Fleet has no such candidate. One of another Fleet is reported ' +
      'the same way.',
  })
  @ApiConflictResponse({
    description:
      'It changed since the reviewer loaded it, cannot be resolved, or is ' +
      'not in a state the action applies to.',
  })
  async decide(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @UserId() userId: string,
    @Body() body: DecideRosterIdentityCandidateDto,
  ): Promise<RosterIdentityCandidateDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    return this._reviewService.decide(fleetId, candidateId, userId, body);
  }
}
