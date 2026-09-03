import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ArcMembershipDto } from './dto/arc.dto';
import { ArcStoryDto } from './dto/update-arc.dto';
import { StorytimeArcMembershipPresenter } from './storytime-arc-membership.presenter';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
import { StorytimeArcService } from './storytime-arc.service';

/**
 * Answering whether a Story belongs in an Arc.
 *
 * The same routes serve both sides. Which of them may answer a given
 * membership depends on who opened it, and the service decides that — a
 * curator cannot accept their own invitation, and an owner cannot accept their
 * own request.
 */
@ApiTags('Storytime (creator)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storytime/manage/arc-memberships')
export class StorytimeArcMembershipsController {
  /**
   * Creates an instance of StorytimeArcMembershipsController.
   *
   * @param _membershipService - The membership service.
   * @param _arcService - Resolves the Arcs the caller curates.
   * @param _storyService - Resolves the Stories the caller owns.
   * @param _presenter - Pairs memberships with the Stories they name.
   * @param _featureService - Reports whether creation is switched on.
   */
  constructor(
    private readonly _membershipService: StorytimeArcMembershipService,
    private readonly _arcService: StorytimeArcService,
    private readonly _storyService: StorytimeStoryService,
    private readonly _presenter: StorytimeArcMembershipPresenter,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the Arc decisions waiting on the caller.
   *
   * Both directions at once: invitations to their Stories and requests to
   * their Arcs are the same kind of thing to the person answering.
   *
   * @param userId - The caller.
   * @returns The memberships waiting on them.
   */
  @Get('pending')
  @ApiOperation({ summary: 'List the Arc decisions waiting on you' })
  @ApiOkResponse({ type: [ArcMembershipDto] })
  async findPending(@UserId() userId: string): Promise<ArcMembershipDto[]> {
    await this.assertEnabled();

    const [stories, arcs] = await Promise.all([
      this._storyService.findOwnedByUser(userId),
      this._arcService.findOwnedByUser(userId),
    ]);

    return this._presenter.withStories(
      await this._membershipService.findPendingForUser(
        stories.map(story => story.id),
        arcs.map(arc => arc.id),
      ),
      userId,
    );
  }

  /**
   * Offers one of the caller's Stories to an Arc.
   *
   * Joins outright when the caller curates the Arc as well, because there is
   * then nobody left to ask.
   *
   * @param arcId - The Arc.
   * @param dto - The Story to offer.
   * @param userId - The caller.
   * @returns The membership, joined or waiting on the curator.
   */
  @Post('arcs/:arcId/request')
  @ApiOperation({ summary: 'Ask for one of your Stories to join an Arc' })
  @ApiOkResponse({ type: [ArcMembershipDto] })
  @ApiBadRequestResponse({ description: 'That Story is already in the Arc.' })
  async request(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @Body() dto: ArcStoryDto,
    @UserId() userId: string,
  ): Promise<ArcMembershipDto[]> {
    await this.assertEnabled();

    return this._presenter.withStories(
      [await this._membershipService.request(arcId, dto.storyId, userId)],
      userId,
    );
  }

  /**
   * Agrees to a pending membership.
   *
   * @param membershipId - The membership.
   * @param userId - The caller.
   * @returns The approved membership.
   */
  @Post(':membershipId/approve')
  @ApiOperation({ summary: 'Agree that a Story belongs in an Arc' })
  @ApiOkResponse({ type: [ArcMembershipDto] })
  @ApiForbiddenResponse({ description: 'That is the other side’s decision.' })
  async approve(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @UserId() userId: string,
  ): Promise<ArcMembershipDto[]> {
    await this.assertEnabled();

    return this._presenter.withStories(
      [await this._membershipService.approve(membershipId, userId)],
      userId,
    );
  }

  /**
   * Turns down a pending membership.
   *
   * @param membershipId - The membership.
   * @param userId - The caller.
   * @returns The declined membership.
   */
  @Post(':membershipId/decline')
  @ApiOperation({ summary: 'Turn down a Story’s place in an Arc' })
  @ApiOkResponse({ type: [ArcMembershipDto] })
  async decline(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @UserId() userId: string,
  ): Promise<ArcMembershipDto[]> {
    await this.assertEnabled();

    return this._presenter.withStories(
      [await this._membershipService.decline(membershipId, userId)],
      userId,
    );
  }

  /**
   * Takes a Story out of an Arc, from either side.
   *
   * @param membershipId - The membership.
   * @param userId - The caller.
   * @returns The ended membership.
   */
  @Post(':membershipId/leave')
  @ApiOperation({ summary: 'Take a Story out of an Arc' })
  @ApiOkResponse({ type: [ArcMembershipDto] })
  async leave(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @UserId() userId: string,
  ): Promise<ArcMembershipDto[]> {
    await this.assertEnabled();

    return this._presenter.withStories(
      [await this._membershipService.leave(membershipId, userId)],
      userId,
    );
  }

  /**
   * Requires that Storytime creation is switched on.
   */
  private async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );
  }
}
