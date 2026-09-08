import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { FeedEntryDto, FollowStateDto, UnreadCountDto } from './dto/follow.dto';
import { StorytimeActivityFeedService } from './storytime-activity-feed.service';
import {
  FollowTargetKind,
  StorytimeFollowService,
} from './storytime-follow.service';
import { StorytimeSocialMapper } from './storytime-social.mapper';

/**
 * Following creators, Stories and Arcs, and the feed that comes of it.
 *
 * Everything here needs sign-in: a follow is a relationship between a person
 * and something, and a feed is one person's.
 */
@ApiTags('Storytime')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storytime')
export class StorytimeFollowsController {
  /**
   * Creates an instance of StorytimeFollowsController.
   *
   * @param _followService - Follows.
   * @param _feedService - The activity feed.
   * @param _mapper - Maps feed entries to their response shape.
   */
  constructor(
    private readonly _followService: StorytimeFollowService,
    private readonly _feedService: StorytimeActivityFeedService,
    private readonly _mapper: StorytimeSocialMapper,
  ) {}

  /**
   * Follows a creator, a Story or an Arc.
   *
   * @param kind - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The follower.
   * @returns That they now follow it.
   */
  @Post('follows/:kind/:targetId')
  @ApiOperation({ summary: 'Follow a creator, Story or Arc' })
  @ApiOkResponse({ type: FollowStateDto })
  @ApiBadRequestResponse({ description: 'You cannot follow yourself.' })
  async follow(
    @Param('kind') kind: FollowTargetKind,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @UserId() userId: string,
  ): Promise<FollowStateDto> {
    return {
      isFollowing: await this._followService.follow(kind, targetId, userId),
      followerCount: await this._followService.countFollowers(kind, targetId),
    };
  }

  /**
   * Stops following something.
   *
   * @param kind - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The follower.
   * @returns That they no longer follow it.
   */
  @Delete('follows/:kind/:targetId')
  @ApiOperation({ summary: 'Stop following something' })
  @ApiOkResponse({ type: FollowStateDto })
  async unfollow(
    @Param('kind') kind: FollowTargetKind,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @UserId() userId: string,
  ): Promise<FollowStateDto> {
    return {
      isFollowing: await this._followService.unfollow(kind, targetId, userId),
      followerCount: await this._followService.countFollowers(kind, targetId),
    };
  }

  /**
   * Reports whether the caller follows something.
   *
   * @param kind - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The reader.
   * @returns Whether they follow it, and how many others do.
   */
  @Get('follows/:kind/:targetId')
  @ApiOperation({ summary: 'Check whether you follow something' })
  @ApiOkResponse({ type: FollowStateDto })
  async findState(
    @Param('kind') kind: FollowTargetKind,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @UserId() userId: string,
  ): Promise<FollowStateDto> {
    return {
      isFollowing: await this._followService.isFollowing(
        kind,
        targetId,
        userId,
      ),
      followerCount: await this._followService.countFollowers(kind, targetId),
    };
  }

  /**
   * Reads the caller's feed.
   *
   * @param userId - The reader.
   * @param page - The page wanted.
   * @returns What the people and work they follow have been doing.
   */
  @Get('feed')
  @ApiOperation({ summary: 'Read your Storytime feed' })
  @ApiOkResponse({ type: [FeedEntryDto] })
  async findFeed(
    @UserId() userId: string,
    @Query('page') page?: string,
  ): Promise<FeedEntryDto[]> {
    return this._mapper.toFeed(
      await this._feedService.findFeed(userId, Number(page) || 1),
    );
  }

  /**
   * Counts what the caller has not seen.
   *
   * @param userId - The reader.
   * @returns How many unseen items they may read.
   */
  @Get('feed/unread')
  @ApiOperation({ summary: 'Count what is new in your feed' })
  @ApiOkResponse({ type: UnreadCountDto })
  async countUnread(@UserId() userId: string): Promise<UnreadCountDto> {
    return { unread: await this._feedService.countUnread(userId) };
  }

  /**
   * Marks the caller's feed as seen.
   *
   * @param userId - The reader.
   */
  @Post('feed/read')
  @ApiOperation({ summary: 'Mark your feed as read' })
  @ApiOkResponse({ description: 'The feed was marked as read.' })
  async markRead(@UserId() userId: string): Promise<void> {
    await this._feedService.markRead(userId);
  }
}
