import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId, UserId } from 'src/auth/user-id.decorator';

import { FleetAudienceService } from './authorisation/fleet-audience.service';
import { FLEET_CAPABILITIES } from './authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from './authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from './authorisation/scope-capability.guard';
import { FLEET_FEATURE_FLAGS } from './constants/fleet-feature.constants';
import { CreateStoFleetDto } from './dto/create-sto-fleet.dto';
import { FindScopeDuplicatesDto } from './dto/find-scope-duplicates.dto';
import {
  FleetDuplicateDto,
  RegisteredStoFleetDto,
  StoFleetDto,
} from './dto/sto-fleet.dto';
import { UpdateStoFleetDto } from './dto/update-sto-fleet.dto';
import { StoFleetEntity } from './entities/sto-fleet.entity';
import { FleetScopeKind } from './enums/fleet-scope-kind.enum';
import { FleetFeatureService } from './fleet-feature.service';
import { StoFleetMapper } from './mappers/sto-fleet.mapper';
import { StoFleetService } from './services/sto-fleet.service';

/**
 * The Fleets a Community records.
 *
 * Every route states its tenancy in the path, and the guard checks it rather
 * than trusting it: a Fleet that belongs to a different Community than the
 * path claims resolves to nothing and is reported as absent. That is what
 * makes the Community segment load-bearing instead of decorative, which is
 * the shape most cross-tenant mistakes take.
 *
 * ## Who may do what
 *
 * **Registering** is `scope.children.register` at the *Community*. There is
 * no Fleet yet to hold a capability at, so the check has to be against the
 * thing the Fleet is being added to. The capability is delegable, so a
 * Community need not route every new Fleet through its Owner.
 *
 * **Changing and closing** are `scope.settings.manage` and `scope.close` at
 * the *Fleet*. A Fleet is a scope in its own right once it exists, and its
 * own settings are its own business — the same two capabilities the Community
 * routes use, held one level down.
 *
 * **Reading** is visibility rather than capability (ADR-0002). A signed-out
 * visitor may read a `PUBLIC` Fleet and do nothing to it.
 *
 * ## The duplicate warning is a warning
 *
 * Two Communities may each hold a record for the same in-game Fleet and
 * neither is authoritative, so registration never refuses one for being a
 * duplicate. {@link findDuplicates} exists so the form can say what already
 * exists before anything is written, and the registration response repeats
 * the answer — a preflight can be stale by the time the form is submitted,
 * and the warning has to be true of what was actually saved.
 */
@ApiTags('Fleet')
@Controller('fleet-communities/:communityId/fleets')
export class CommunityFleetsController {
  /**
   * Creates an instance of CommunityFleetsController.
   *
   * @param _fleetService - Registers, reads and changes Fleets.
   * @param _audienceService - Answers whether a caller may see a Fleet.
   * @param _featureService - Reports whether the feature is switched on.
   * @param _mapper - Turns a Fleet into its API shapes.
   */
  constructor(
    private readonly _fleetService: StoFleetService,
    private readonly _audienceService: FleetAudienceService,
    private readonly _featureService: FleetFeatureService,
    private readonly _mapper: StoFleetMapper,
  ) {}

  /**
   * Registers a Fleet under the Community.
   *
   * @param communityId - The Community.
   * @param userId - The caller.
   * @param dto - What to register.
   * @returns The Fleet, and anything that already answered to its name.
   */
  @Post()
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER, {
    kind: FleetScopeKind.COMMUNITY,
    param: 'communityId',
  })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register a Fleet',
    description:
      'Succeeds even when a record for the same name already exists on the ' +
      'same platform. Any such records come back alongside the new one.',
  })
  @ApiCreatedResponse({ type: RegisteredStoFleetDto })
  @ApiConflictResponse({
    description: 'Another registration took the web address first.',
  })
  async register(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @UserId() userId: string,
    @Body() dto: CreateStoFleetDto,
  ): Promise<RegisteredStoFleetDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED,
    );

    const registered = await this._fleetService.register(
      communityId,
      dto,
      userId,
    );

    return {
      fleet: this._mapper.toDto(registered.fleet),
      duplicates: registered.duplicates.map(duplicate =>
        this._mapper.toDuplicateDto(duplicate),
      ),
    };
  }

  /**
   * Reports what already answers to a name on a platform.
   *
   * Declared before the identifier route so the literal segment wins: Nest
   * matches in declaration order, and `:fleetId` would otherwise swallow
   * `duplicates` and answer `400` for a perfectly good request.
   *
   * Behind the same capability as registering, because it reports the
   * Community's own records whatever their audience, and only somebody who
   * may add a Fleet has any reason to ask.
   *
   * @param communityId - The Community the registrant is acting in.
   * @param query - The platform and the name being considered.
   * @returns The records that already answer to it.
   */
  @Get('duplicates')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER, {
    kind: FleetScopeKind.COMMUNITY,
    param: 'communityId',
  })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Find records that already answer to a Fleet name',
    description:
      'Advisory only. Matching folds case and nothing else, so a leading or ' +
      'trailing space is treated as the real difference it is in game.',
  })
  @ApiOkResponse({ type: [FleetDuplicateDto] })
  async findDuplicates(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query() query: FindScopeDuplicatesDto,
  ): Promise<FleetDuplicateDto[]> {
    await this._featureService.assertEnabled();

    const duplicates = await this._fleetService.findDuplicates(
      query.platformId,
      query.name,
      { withinCommunityId: communityId },
    );

    return duplicates.map(duplicate => this._mapper.toDuplicateDto(duplicate));
  }

  /**
   * Reads a Fleet.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The viewer, or null when signed out.
   * @returns The Fleet.
   */
  @Get(':fleetId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read a Fleet' })
  @ApiOkResponse({ type: StoFleetDto })
  @ApiNotFoundResponse({
    description:
      'No such Fleet in that Community, or the caller may not see it. The ' +
      'two are reported the same way so a probe cannot confirm that a ' +
      'private Fleet exists.',
  })
  async findOne(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<StoFleetDto> {
    await this._featureService.assertEnabled();

    const fleet = await this._fleetService.findByIdOrFail(communityId, fleetId);

    await this.assertVisible(fleet, userId);

    return this._mapper.toDto(fleet);
  }

  /**
   * Changes a Fleet's own settings.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The caller.
   * @param dto - The changes.
   * @returns The updated Fleet.
   */
  @Patch(':fleetId')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change a Fleet’s settings' })
  @ApiOkResponse({ type: StoFleetDto })
  @ApiConflictResponse({
    description:
      'The Fleet changed since the caller loaded it, or another one took ' +
      'the web address first.',
  })
  async update(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() dto: UpdateStoFleetDto,
  ): Promise<StoFleetDto> {
    await this._featureService.assertEnabled();

    const fleet = await this._fleetService.update(
      communityId,
      fleetId,
      dto,
      userId,
    );

    return this._mapper.toDto(fleet);
  }

  /**
   * Closes a Fleet, keeping everything it holds.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The caller.
   * @returns The closed Fleet.
   */
  @Delete(':fleetId')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_CLOSE, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Close a Fleet',
    description:
      'Closure is a status change, not a deletion. The Fleet stays ' +
      'readable, keeps its Armada placements, roster history and web ' +
      'address, and accepts nothing new.',
  })
  @ApiOkResponse({ type: StoFleetDto })
  async close(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
  ): Promise<StoFleetDto> {
    await this._featureService.assertEnabled();

    const fleet = await this._fleetService.close(communityId, fleetId, userId);

    return this._mapper.toDto(fleet);
  }

  /**
   * Requires that the caller may see a Fleet at all.
   *
   * @param fleet - The Fleet they asked for.
   * @param userId - The viewer, or null when signed out.
   * @throws NotFoundException when they may not see it.
   */
  private async assertVisible(
    fleet: StoFleetEntity,
    userId: string | null,
  ): Promise<void> {
    await this._audienceService.assertCanView(
      fleet.visibility,
      { kind: FleetScopeKind.FLEET, id: fleet.id },
      userId,
    );
  }
}
