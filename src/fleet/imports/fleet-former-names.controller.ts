import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import {
  FleetFormerNameDto,
  FleetFormerNamesDto,
  RecordFleetFormerNameDto,
  RemoveFleetFormerNameDto,
} from './dto/fleet-former-name.dto';
import { FleetFormerNameService } from './services/fleet-former-name.service';

/** Where a Fleet's scope is found in these routes. */
const FLEET_SCOPE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
} as const;

/**
 * A Fleet's former names, which older roster exports are matched against
 * (FC-050).
 *
 * `roster.investigate` records and removes them, which the Owner and Admins
 * hold and can delegate: a name decides which Fleet's roster a file is read
 * into, which is the question that capability already answers for imports
 * and rename candidates. A site admin looking in reads them and changes
 * nothing (FC-036). Behind the imports switch, like everything else a name
 * is matched for.
 */
@ApiTags('Fleet')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/fleets/:fleetId/former-names')
export class FleetFormerNamesController {
  /**
   * Creates an instance of FleetFormerNamesController.
   *
   * @param _formerNames - Reads, records and removes former names.
   * @param _featureService - Reports whether imports are switched on.
   * @param _authorisationService - Says whether the reader may change them.
   */
  constructor(
    private readonly _formerNames: FleetFormerNameService,
    private readonly _featureService: FleetFeatureService,
    private readonly _authorisationService: FleetAuthorisationService,
  ) {}

  /**
   * Lists a Fleet's former names.
   *
   * @param communityId - The Fleet's Community.
   * @param fleetId - The Fleet.
   * @param userId - The reader.
   * @returns The names, and whether the reader may change them.
   */
  @Get()
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(
    [
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE_READ,
    ],
    FLEET_SCOPE,
  )
  @ApiOperation({ summary: "List a Fleet's former names" })
  @ApiOkResponse({ type: FleetFormerNamesDto })
  async list(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
  ): Promise<FleetFormerNamesDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    // Resolved once per request already, by the guard, so this is a lookup
    // in what it found rather than a second authorisation.
    const mayChange = await this._authorisationService.hasCapability(
      userId,
      {
        kind: FleetScopeKind.FLEET,
        id: fleetId,
        withinCommunityId: communityId,
      },
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
    );

    return this._formerNames.list(fleetId, mayChange);
  }

  /**
   * Records a former name.
   *
   * @param fleetId - The Fleet.
   * @param userId - Who is recording it.
   * @param body - The name, when it was used, and why.
   * @returns The name as recorded.
   */
  @Post()
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_INVESTIGATE, FLEET_SCOPE)
  @ApiOperation({ summary: 'Record a former name of a Fleet' })
  @ApiCreatedResponse({ type: FleetFormerNameDto })
  @ApiBadRequestResponse({
    description: 'The interval is backwards, or has not ended yet.',
  })
  @ApiConflictResponse({
    description:
      'It is the Fleet’s name now, or already recorded for part of that time.',
  })
  async record(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() body: RecordFleetFormerNameDto,
  ): Promise<FleetFormerNameDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    return this._formerNames.record(fleetId, userId, body);
  }

  /**
   * Removes a former name, keeping who removed it and why.
   *
   * @param fleetId - The Fleet.
   * @param aliasId - The name.
   * @param userId - Who is removing it.
   * @param body - Why.
   * @returns The name as it now stands.
   */
  @Post(':aliasId/removal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_INVESTIGATE, FLEET_SCOPE)
  @ApiOperation({ summary: 'Remove a former name of a Fleet' })
  @ApiOkResponse({ type: FleetFormerNameDto })
  @ApiNotFoundResponse({
    description:
      'The Fleet has no such name in use. One of another Fleet is reported ' +
      'the same way.',
  })
  async remove(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('aliasId', ParseUUIDPipe) aliasId: string,
    @UserId() userId: string,
    @Body() body: RemoveFleetFormerNameDto,
  ): Promise<FleetFormerNameDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    return this._formerNames.remove(fleetId, aliasId, userId, body);
  }
}
