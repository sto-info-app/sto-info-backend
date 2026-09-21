import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId } from 'src/auth/user-id.decorator';

import { FleetAudienceService } from './authorisation/fleet-audience.service';
import { ResolvedStoArmadaDto } from './dto/sto-armada.dto';
import { ResolvedStoFleetDto } from './dto/sto-fleet.dto';
import { FleetScopeKind } from './enums/fleet-scope-kind.enum';
import { FleetFeatureService } from './fleet-feature.service';
import { StoArmadaMapper } from './mappers/sto-armada.mapper';
import { StoFleetMapper } from './mappers/sto-fleet.mapper';
import { FleetCommunityService } from './services/fleet-community.service';
import { FleetPlatformService } from './services/fleet-platform.service';
import { StoArmadaService } from './services/sto-armada.service';
import { StoFleetService } from './services/sto-fleet.service';
import { toPlatformSegment } from './utilities/platform-segment.utility';

/**
 * Turns a canonical Fleet or Armada address into the record it names.
 *
 * `/fleet-communities/by-slug/steves-fleets/fleets/windows/omega-command` is
 * the address a person reads, types and pastes into Discord, and this is the
 * one call that resolves the whole of it. Doing it in one request is the
 * point: an Angular route resolver that had to fetch the Community, then the
 * platform, then the Fleet would show three loading states for one page and
 * would have to invent its own answer when the second call disagreed with the
 * first.
 *
 * ## Why not a redirect
 *
 * Any of the three segments may be out of date, and the answer is still a
 * `200` carrying the current ones. The caller is a single-page application
 * that has to replace its own history entry, and a `301` would have been
 * followed by the browser before the application could see it — ADR-0022.
 *
 * ## Routing
 *
 * The prefix is a literal `by-slug` segment, so nothing here can be confused
 * with `/fleet-communities/:communityId/fleets/...`: that path needs `fleets`
 * where this one has a Community slug. Each segment is still resolved against
 * the one above it, so a Fleet addressed under a Community that does not hold
 * it is absent rather than redirected somewhere plausible.
 */
@ApiTags('Fleet')
@Controller('fleet-communities/by-slug/:communitySlug')
export class FleetScopeResolutionController {
  /**
   * Creates an instance of FleetScopeResolutionController.
   *
   * @param _communityService - Resolves the Community segment.
   * @param _platformService - Resolves the platform segment.
   * @param _fleetService - Resolves the Fleet segment.
   * @param _armadaService - Resolves the Armada segment.
   * @param _audienceService - Answers whether a caller may see what it found.
   * @param _featureService - Reports whether the feature is switched on.
   * @param _fleetMapper - Turns a Fleet into its API shape.
   * @param _armadaMapper - Turns an Armada into its API shape.
   */
  constructor(
    private readonly _communityService: FleetCommunityService,
    private readonly _platformService: FleetPlatformService,
    private readonly _fleetService: StoFleetService,
    private readonly _armadaService: StoArmadaService,
    private readonly _audienceService: FleetAudienceService,
    private readonly _featureService: FleetFeatureService,
    private readonly _fleetMapper: StoFleetMapper,
    private readonly _armadaMapper: StoArmadaMapper,
  ) {}

  /**
   * Resolves a Fleet from its canonical address.
   *
   * @param communitySlug - The Community segment.
   * @param platformSegment - The platform segment.
   * @param fleetSlug - The Fleet segment.
   * @param userId - The viewer, or null when signed out.
   * @returns The Fleet and the current form of every segment.
   */
  @Get('fleets/:platformSegment/:fleetSlug')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Resolve a Fleet from its canonical URL',
    description:
      'Answers 200 with the current segments even when the address used is ' +
      'an old one, so the caller can replace its own history entry.',
  })
  @ApiOkResponse({ type: ResolvedStoFleetDto })
  @ApiNotFoundResponse({
    description:
      'No Fleet answers to that address, now or in the past — or the ' +
      'caller may not see the one that does.',
  })
  async resolveFleet(
    @Param('communitySlug') communitySlug: string,
    @Param('platformSegment') platformSegment: string,
    @Param('fleetSlug') fleetSlug: string,
    @OptionalUserId() userId: string | null,
  ): Promise<ResolvedStoFleetDto> {
    await this._featureService.assertEnabled();

    const community =
      await this._communityService.resolveBySlugOrFail(communitySlug);

    await this._audienceService.assertCanView(
      community.community.visibility,
      { kind: FleetScopeKind.COMMUNITY, id: community.community.id },
      userId,
    );

    const platform =
      await this._platformService.findBySegmentOrFail(platformSegment);

    const resolved = await this._fleetService.resolveBySlugOrFail(
      community.community.id,
      platform.id,
      fleetSlug,
    );

    await this._audienceService.assertCanView(
      resolved.fleet.visibility,
      { kind: FleetScopeKind.FLEET, id: resolved.fleet.id },
      userId,
    );

    const canonicalPlatformSegment = toPlatformSegment(platform.name);

    return {
      fleet: this._fleetMapper.toDto(resolved.fleet),
      communitySlug: community.community.slug,
      platformSegment: canonicalPlatformSegment,
      redirected:
        resolved.redirected ||
        community.redirectedFrom !== null ||
        platformSegment !== canonicalPlatformSegment,
    };
  }

  /**
   * Resolves an Armada from its canonical address.
   *
   * There is no second audience check after the Community's. An Armada
   * carries no audience of its own — `sto_armada` has no such column — so
   * being allowed to see the Community is the whole of the question.
   *
   * @param communitySlug - The Community segment.
   * @param platformSegment - The platform segment.
   * @param armadaSlug - The Armada segment.
   * @param userId - The viewer, or null when signed out.
   * @returns The Armada and the current form of every segment.
   */
  @Get('armadas/:platformSegment/:armadaSlug')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Resolve an Armada from its canonical URL',
    description:
      'Answers 200 with the current segments even when the address used is ' +
      'an old one, so the caller can replace its own history entry.',
  })
  @ApiOkResponse({ type: ResolvedStoArmadaDto })
  @ApiNotFoundResponse({
    description:
      'No Armada answers to that address, now or in the past — or the ' +
      'caller may not see the Community holding it.',
  })
  async resolveArmada(
    @Param('communitySlug') communitySlug: string,
    @Param('platformSegment') platformSegment: string,
    @Param('armadaSlug') armadaSlug: string,
    @OptionalUserId() userId: string | null,
  ): Promise<ResolvedStoArmadaDto> {
    await this._featureService.assertEnabled();

    const community =
      await this._communityService.resolveBySlugOrFail(communitySlug);

    await this._audienceService.assertCanView(
      community.community.visibility,
      { kind: FleetScopeKind.COMMUNITY, id: community.community.id },
      userId,
    );

    const platform =
      await this._platformService.findBySegmentOrFail(platformSegment);

    const resolved = await this._armadaService.resolveBySlugOrFail(
      community.community.id,
      platform.id,
      armadaSlug,
    );

    const canonicalPlatformSegment = toPlatformSegment(platform.name);

    return {
      armada: this._armadaMapper.toDto(resolved.armada),
      communitySlug: community.community.slug,
      platformSegment: canonicalPlatformSegment,
      redirected:
        resolved.redirected ||
        community.redirectedFrom !== null ||
        platformSegment !== canonicalPlatformSegment,
    };
  }
}
