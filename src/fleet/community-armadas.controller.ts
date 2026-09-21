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
import { CreateStoArmadaDto } from './dto/create-sto-armada.dto';
import { FindScopeDuplicatesDto } from './dto/find-scope-duplicates.dto';
import {
  ArmadaDuplicateDto,
  RegisteredStoArmadaDto,
  StoArmadaDto,
} from './dto/sto-armada.dto';
import { UpdateStoArmadaDto } from './dto/update-sto-armada.dto';
import { StoArmadaEntity } from './entities/sto-armada.entity';
import { FleetScopeKind } from './enums/fleet-scope-kind.enum';
import { FleetFeatureService } from './fleet-feature.service';
import { StoArmadaMapper } from './mappers/sto-armada.mapper';
import { StoArmadaService } from './services/sto-armada.service';

/**
 * The Armadas a Community records.
 *
 * The same shape as the Fleet routes, with the same capabilities held at the
 * same levels: registering is checked at the Community because there is no
 * Armada yet to check against, and changing or closing one is checked at the
 * Armada, which is a scope in its own right once it exists.
 *
 * ## Reading an Armada is reading its Community
 *
 * `sto_armada` has no visibility column, so there is no audience of its own
 * to consult. The Community's is applied instead: an Armada in a private
 * Community is as private as the Community, and one in a public Community is
 * public. That is a deliberate inheritance rather than a gap — an Armada is
 * a grouping a Community publishes, and a Community that has chosen not to
 * be seen has not chosen to publish anything.
 *
 * ## Managing the Armada is not managing its placements
 *
 * These routes register, rename and close the Armada record. Which Fleets
 * are in it, at what tier and over what interval, is `armada.manage` against
 * `armada_fleet_membership`, and it belongs to FC-024 along with the
 * topology rules a placement has to satisfy.
 */
@ApiTags('Fleet')
@Controller('fleet-communities/:communityId/armadas')
export class CommunityArmadasController {
  /**
   * Creates an instance of CommunityArmadasController.
   *
   * @param _armadaService - Registers, reads and changes Armadas.
   * @param _audienceService - Answers whether a caller may see one.
   * @param _featureService - Reports whether the feature is switched on.
   * @param _mapper - Turns an Armada into its API shapes.
   */
  constructor(
    private readonly _armadaService: StoArmadaService,
    private readonly _audienceService: FleetAudienceService,
    private readonly _featureService: FleetFeatureService,
    private readonly _mapper: StoArmadaMapper,
  ) {}

  /**
   * Registers an Armada under the Community.
   *
   * @param communityId - The Community.
   * @param userId - The caller.
   * @param dto - What to register.
   * @returns The Armada, and anything that already answered to its name.
   */
  @Post()
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_CHILDREN_REGISTER, {
    kind: FleetScopeKind.COMMUNITY,
    param: 'communityId',
  })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register an Armada',
    description:
      'Succeeds even when a record for the same name already exists on the ' +
      'same platform, which for an Armada is the normal case: every member ' +
      'Fleet’s Community has reason to record the Armada it belongs to.',
  })
  @ApiCreatedResponse({ type: RegisteredStoArmadaDto })
  @ApiConflictResponse({
    description: 'Another registration took the web address first.',
  })
  async register(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @UserId() userId: string,
    @Body() dto: CreateStoArmadaDto,
  ): Promise<RegisteredStoArmadaDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED,
    );

    const registered = await this._armadaService.register(
      communityId,
      dto,
      userId,
    );

    return {
      armada: this._mapper.toDto(registered.armada),
      duplicates: registered.duplicates.map(duplicate =>
        this._mapper.toDuplicateDto(duplicate),
      ),
    };
  }

  /**
   * Reports what already answers to a name on a platform.
   *
   * Declared before the identifier route so the literal segment wins.
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
    summary: 'Find records that already answer to an Armada name',
    description: 'Advisory only. Matching folds case and nothing else.',
  })
  @ApiOkResponse({ type: [ArmadaDuplicateDto] })
  async findDuplicates(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query() query: FindScopeDuplicatesDto,
  ): Promise<ArmadaDuplicateDto[]> {
    await this._featureService.assertEnabled();

    const duplicates = await this._armadaService.findDuplicates(
      query.platformId,
      query.name,
      { withinCommunityId: communityId },
    );

    return duplicates.map(duplicate => this._mapper.toDuplicateDto(duplicate));
  }

  /**
   * Reads an Armada.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param userId - The viewer, or null when signed out.
   * @returns The Armada.
   */
  @Get(':armadaId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read an Armada' })
  @ApiOkResponse({ type: StoArmadaDto })
  @ApiNotFoundResponse({
    description:
      'No such Armada in that Community, or the caller may not see the ' +
      'Community holding it.',
  })
  async findOne(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<StoArmadaDto> {
    await this._featureService.assertEnabled();

    const armada = await this._armadaService.findByIdOrFail(
      communityId,
      armadaId,
    );

    await this.assertVisible(armada, userId);

    return this._mapper.toDto(armada);
  }

  /**
   * Changes an Armada's own settings.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param userId - The caller.
   * @param dto - The changes.
   * @returns The updated Armada.
   */
  @Patch(':armadaId')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE, {
    kind: FleetScopeKind.ARMADA,
    param: 'armadaId',
    communityParam: 'communityId',
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change an Armada’s settings' })
  @ApiOkResponse({ type: StoArmadaDto })
  @ApiConflictResponse({
    description:
      'The Armada changed since the caller loaded it, or another one took ' +
      'the web address first.',
  })
  async update(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @UserId() userId: string,
    @Body() dto: UpdateStoArmadaDto,
  ): Promise<StoArmadaDto> {
    await this._featureService.assertEnabled();

    const armada = await this._armadaService.update(
      communityId,
      armadaId,
      dto,
      userId,
    );

    return this._mapper.toDto(armada);
  }

  /**
   * Closes an Armada, keeping its placements readable.
   *
   * @param communityId - The Community.
   * @param armadaId - The Armada.
   * @param userId - The caller.
   * @returns The closed Armada.
   */
  @Delete(':armadaId')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_CLOSE, {
    kind: FleetScopeKind.ARMADA,
    param: 'armadaId',
    communityParam: 'communityId',
  })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Close an Armada',
    description:
      'Closure is a status change, not a deletion. Which Fleets were in it ' +
      'and when stays readable, which is what makes the history of a wound ' +
      'up Armada worth anything.',
  })
  @ApiOkResponse({ type: StoArmadaDto })
  async close(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @UserId() userId: string,
  ): Promise<StoArmadaDto> {
    await this._featureService.assertEnabled();

    const armada = await this._armadaService.close(
      communityId,
      armadaId,
      userId,
    );

    return this._mapper.toDto(armada);
  }

  /**
   * Requires that the caller may see the Community holding an Armada.
   *
   * The Community's audience, checked against the Community, because that is
   * where the audience was declared. Pairing an audience with a scope it was
   * not set on is the kind of mismatch that quietly widens a check.
   *
   * @param armada - The Armada they asked for, with its Community loaded.
   * @param userId - The viewer, or null when signed out.
   * @throws NotFoundException when they may not see it.
   */
  private async assertVisible(
    armada: StoArmadaEntity,
    userId: string | null,
  ): Promise<void> {
    await this._audienceService.assertCanView(
      armada.community.visibility,
      { kind: FleetScopeKind.COMMUNITY, id: armada.communityId },
      userId,
    );
  }
}
