import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId, UserId } from 'src/auth/user-id.decorator';

import { FleetFeatureService } from '../fleet-feature.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
  GovernanceScope,
} from '../governance/utilities/governance-scope.utility';
import { ActivityPageDto, ActivityQueryDto } from './dto/activity.dto';
import { ActivityFeedService } from './services/activity-feed.service';

/** Where one kind of scope's activity is addressed. */
interface ActivityRoutes {
  /** The route prefix, ending in `/activity`. */
  readonly path: string;
  /** The path parameter naming the scope itself. */
  readonly param: string;
  /** Names the scope from the Community and the scope's own ID. */
  readonly scopeOf: (communityId: string, id: string) => GovernanceScope;
}

/**
 * Builds one kind of scope's activity route (FC-029), as its news and events
 * are built: one definition under three prefixes. Whoever may see each item
 * reads it, signed in or not.
 *
 * @param routes - Where this kind of scope's activity is addressed.
 * @returns The controller class.
 */
function activityController(routes: ActivityRoutes) {
  @ApiTags('Fleet activity')
  @ApiBearerAuth()
  @Controller(routes.path)
  class ActivityController {
    /**
     * Creates an instance of the controller.
     *
     * @param _featureService - Reports whether the Fleet feature is on.
     * @param _feed - Reads activity.
     */
    constructor(
      readonly _featureService: FleetFeatureService,
      readonly _feed: ActivityFeedService,
    ) {}

    /**
     * Reads a page of the scope's own activity.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param userId - The reader, or null when signed out.
     * @param query - Where to carry on from.
     * @returns The page, newest first.
     */
    @Get()
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'Read a scope’s activity' })
    @ApiOkResponse({ type: ActivityPageDto })
    @ApiNotFoundResponse({ description: 'The reader may not see the scope.' })
    async feed(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @OptionalUserId() userId: string | null,
      @Query() query: ActivityQueryDto,
    ): Promise<ActivityPageDto> {
      await this._featureService.assertEnabled();

      return this._feed.scopeFeed(
        routes.scopeOf(communityId, id),
        userId,
        query,
      );
    }
  }

  return ActivityController;
}

/** A Community's own activity. */
export class CommunityActivityController extends activityController({
  path: 'fleet-communities/:communityId/activity',
  param: 'communityId',
  scopeOf: communityId => communityScope(communityId),
}) {}

/** A Fleet's activity. */
export class FleetActivityController extends activityController({
  path: 'fleet-communities/:communityId/fleets/:fleetId/activity',
  param: 'fleetId',
  scopeOf: fleetScope,
}) {}

/** An Armada's activity. */
export class ArmadaActivityController extends activityController({
  path: 'fleet-communities/:communityId/armadas/:armadaId/activity',
  param: 'armadaId',
  scopeOf: armadaScope,
}) {}

/**
 * Somebody's own feed (FC-029): every Community they follow or own, and
 * every scope they belong to.
 */
@ApiTags('Fleet activity')
@ApiBearerAuth()
@Controller('fleet-activity')
export class PersonalActivityController {
  /**
   * Creates an instance of PersonalActivityController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _feed - Reads activity.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _feed: ActivityFeedService,
  ) {}

  /**
   * Reads a page of the caller's own feed.
   *
   * @param userId - The caller.
   * @param query - Where to carry on from.
   * @returns The page, newest first.
   */
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Read your own Fleet activity' })
  @ApiOkResponse({ type: ActivityPageDto })
  async mine(
    @UserId() userId: string,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityPageDto> {
    await this._featureService.assertEnabled();

    return this._feed.personalFeed(userId, query);
  }
}
