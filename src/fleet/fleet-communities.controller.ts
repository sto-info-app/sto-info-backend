import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { CreateFleetCommunityDto } from './dto/create-fleet-community.dto';
import {
  FleetCommunityDto,
  ResolvedFleetCommunityDto,
} from './dto/fleet-community.dto';
import { UpdateFleetCommunityDto } from './dto/update-fleet-community.dto';
import { FleetScopeKind } from './enums/fleet-scope-kind.enum';
import { FleetFeatureService } from './fleet-feature.service';
import { FleetCommunityMapper } from './mappers/fleet-community.mapper';
import { FleetCommunityService } from './services/fleet-community.service';

/**
 * Registering and running a Fleet Community.
 *
 * The Community is the outermost scope, so these routes are the only ones in
 * the feature that cannot name a parent: there is nothing above a Community
 * for a path segment to check against. Everything nested beneath it —
 * `/fleet-communities/:communityId/fleets`, `/armadas`, `/roster-imports` —
 * states its tenancy in the path and has {@link ScopeCapabilityGuard} check it.
 *
 * ## Who may do what
 *
 * **Registering** needs nothing but an account. There is no scope to hold a
 * capability at yet, which is precisely why the owner limit is a database
 * trigger rather than a guard: the only thing standing between an account and
 * an unlimited number of directory entries is a count, and a count has to be
 * taken somewhere it cannot race.
 *
 * **Reading** is visibility rather than capability, and the two are different
 * questions answered by different records (ADR-0002). A signed-out visitor may
 * read a `PUBLIC` Community and do nothing to it.
 *
 * **Changing and closing** are capabilities held at the Community, checked by
 * the guard before the handler runs.
 *
 * ## Why closing is the `DELETE`
 *
 * Plan section 4.1 is explicit that a scope closes rather than disappears: its
 * Armada placements, roster history and URL all outlive it. `DELETE` is the
 * verb a client reaches for and closure is what the verb means here, so the
 * route is named for the intent and the response says what actually happened —
 * a `CLOSED` Community, still readable, accepting nothing new. Erasing one
 * outright is account erasure's problem (FC-038) and needs decisions this
 * ticket does not make.
 *
 * ## Refusal order
 *
 * The feature switch first, answering `404` rather than "disabled", so a
 * staged rollout does not advertise what is coming. Then the capability. Then
 * the body.
 */
@ApiTags('Fleet')
@Controller('fleet-communities')
export class FleetCommunitiesController {
  /**
   * Creates an instance of FleetCommunitiesController.
   *
   * @param _communityService - Registers, reads and changes Communities.
   * @param _audienceService - Answers whether a caller may see a Community.
   * @param _featureService - Reports whether the feature is switched on.
   * @param _mapper - Turns a Community into its API shape.
   */
  constructor(
    private readonly _communityService: FleetCommunityService,
    private readonly _audienceService: FleetAudienceService,
    private readonly _featureService: FleetFeatureService,
    private readonly _mapper: FleetCommunityMapper,
  ) {}

  /**
   * Registers a Community owned by the caller.
   *
   * @param userId - The registrant, who becomes its Owner.
   * @param dto - What to register.
   * @returns The registered Community.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a Fleet Community' })
  @ApiCreatedResponse({ type: FleetCommunityDto })
  @ApiConflictResponse({
    description:
      'The account already owns the maximum number of Fleet Communities, ' +
      'or another registration took the web address first.',
  })
  async register(
    @UserId() userId: string,
    @Body() dto: CreateFleetCommunityDto,
  ): Promise<FleetCommunityDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED,
    );

    const community = await this._communityService.register(dto, userId);

    return this._mapper.toDto(community);
  }

  /**
   * Resolves the Community a URL segment names, following a rename.
   *
   * Declared before the identifier route so the literal segment wins: Nest
   * matches in declaration order, and `:communityId` would otherwise swallow
   * `by-slug` and answer `400` for a perfectly good address.
   *
   * @param slug - The segment from the URL.
   * @param userId - The viewer, or null when signed out.
   * @returns The Community, and the retired segment when one was used.
   */
  @Get('by-slug/:slug')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Resolve a Fleet Community by its URL segment' })
  @ApiOkResponse({ type: ResolvedFleetCommunityDto })
  @ApiNotFoundResponse({
    description:
      'No Community answers to that segment, now or in the past — or the ' +
      'caller may not see the one that does.',
  })
  async resolveBySlug(
    @Param('slug') slug: string,
    @OptionalUserId() userId: string | null,
  ): Promise<ResolvedFleetCommunityDto> {
    await this._featureService.assertEnabled();

    const resolved = await this._communityService.resolveBySlugOrFail(slug);

    await this.assertVisible(resolved.community, userId);

    return {
      community: this._mapper.toDto(resolved.community),
      redirectedFrom: resolved.redirectedFrom,
    };
  }

  /**
   * Reads a Community.
   *
   * @param communityId - The Community.
   * @param userId - The viewer, or null when signed out.
   * @returns The Community.
   */
  @Get(':communityId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read a Fleet Community' })
  @ApiOkResponse({ type: FleetCommunityDto })
  @ApiNotFoundResponse({
    description:
      'No such Community, or the caller may not see it. The two are ' +
      'reported the same way so a probe cannot confirm a private Community ' +
      'exists.',
  })
  async findOne(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<FleetCommunityDto> {
    await this._featureService.assertEnabled();

    const community = await this._communityService.findByIdOrFail(communityId);

    await this.assertVisible(community, userId);

    return this._mapper.toDto(community);
  }

  /**
   * Changes a Community's own settings.
   *
   * @param communityId - The Community.
   * @param userId - The caller.
   * @param dto - The changes.
   * @returns The updated Community.
   */
  @Patch(':communityId')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_SETTINGS_MANAGE, {
    kind: FleetScopeKind.COMMUNITY,
    param: 'communityId',
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change a Fleet Community’s settings' })
  @ApiOkResponse({ type: FleetCommunityDto })
  @ApiConflictResponse({
    description:
      'The Community changed since the caller loaded it, or another one ' +
      'took the web address first.',
  })
  async update(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @UserId() userId: string,
    @Body() dto: UpdateFleetCommunityDto,
  ): Promise<FleetCommunityDto> {
    await this._featureService.assertEnabled();

    const community = await this._communityService.update(
      communityId,
      dto,
      userId,
    );

    return this._mapper.toDto(community);
  }

  /**
   * Closes a Community, keeping everything it holds.
   *
   * @param communityId - The Community.
   * @param userId - The caller.
   * @returns The closed Community.
   */
  @Delete(':communityId')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_CLOSE, {
    kind: FleetScopeKind.COMMUNITY,
    param: 'communityId',
  })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Close a Fleet Community',
    description:
      'Closure is a status change, not a deletion. The Community stays ' +
      'readable, keeps its web address, and accepts nothing new.',
  })
  @ApiOkResponse({ type: FleetCommunityDto })
  async close(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @UserId() userId: string,
  ): Promise<FleetCommunityDto> {
    await this._featureService.assertEnabled();

    const community = await this._communityService.close(communityId, userId);

    return this._mapper.toDto(community);
  }

  /**
   * Requires that the caller may see a Community at all.
   *
   * @param community - The Community they asked for.
   * @param userId - The viewer, or null when signed out.
   * @throws NotFoundException when they may not see it.
   */
  private async assertVisible(
    community: { id: string; visibility: FleetCommunityDto['visibility'] },
    userId: string | null,
  ): Promise<void> {
    await this._audienceService.assertCanView(
      community.visibility,
      { kind: FleetScopeKind.COMMUNITY, id: community.id },
      userId,
    );
  }
}
