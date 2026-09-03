import {
  Body,
  Controller,
  Delete,
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

import { BlockService } from './block.service';
import { BlockedMemberDto } from './dto/blocked-member.dto';
import { CreateBlockDto } from './dto/create-block.dto';
import { CreateFriendRequestDto } from './dto/create-friend-request.dto';
import { FriendRequestsQueryDto } from './dto/friend-requests-query.dto';
import { FriendsQueryDto } from './dto/friends-query.dto';
import {
  CommunitySummaryDto,
  FriendDto,
  FriendRequestDto,
  PaginatedFriendsDto,
} from './dto/friendship.dto';
import { FriendRequestDirection } from './enums/friend-request-direction.enum';
import { FriendshipService } from './friendship.service';

/**
 * The authenticated half of the community: a member's friends, the requests
 * waiting on either side, and the members they have blocked.
 *
 * Every route is guarded and scoped to the caller. Members are addressed by
 * profile username on the way in and described by username on the way out —
 * no user ID crosses this boundary, matching the public registry.
 */
@ApiTags('Community')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('community')
export class CommunityController {
  /**
   * Creates an instance of CommunityController.
   *
   * @param _friendshipService - The friendship service.
   * @param _blockService - The block service.
   */
  constructor(
    private readonly _friendshipService: FriendshipService,
    private readonly _blockService: BlockService,
  ) {}

  // ----- Summary -----

  /**
   * Returns the caller's friend, request and block counts.
   *
   * @param userId - The authenticated user's ID.
   * @returns The community counts.
   */
  @Get('summary')
  @ApiOperation({ summary: 'Get the current user community counts' })
  @ApiOkResponse({ description: 'The counts.', type: CommunitySummaryDto })
  getSummary(@UserId() userId: string): Promise<CommunitySummaryDto> {
    return this._friendshipService.getSummary(userId);
  }

  // ----- Friends -----

  /**
   * Lists the caller's friends.
   *
   * @param userId - The authenticated user's ID.
   * @param query - Search and pagination options.
   * @returns A page of friends.
   */
  @Get('friends')
  @ApiOperation({ summary: 'List the current user friends' })
  @ApiOkResponse({
    description: 'A page of friends.',
    type: PaginatedFriendsDto,
  })
  findFriends(
    @UserId() userId: string,
    @Query() query: FriendsQueryDto,
  ): Promise<PaginatedFriendsDto> {
    return this._friendshipService.findFriends(userId, query);
  }

  /**
   * Ends a friendship.
   *
   * @param userId - The authenticated user's ID.
   * @param friendshipId - The friendship to end.
   */
  @Delete('friends/:friendshipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a friend' })
  @ApiNoContentResponse({ description: 'The friendship was removed.' })
  @ApiNotFoundResponse({ description: 'The caller has no such friendship.' })
  removeFriend(
    @UserId() userId: string,
    @Param('friendshipId', ParseUUIDPipe) friendshipId: string,
  ): Promise<void> {
    return this._friendshipService.removeFriend(userId, friendshipId);
  }

  // ----- Friend requests -----

  /**
   * Lists the caller's pending friend requests in one direction.
   *
   * @param userId - The authenticated user's ID.
   * @param query - The direction to list, defaulting to incoming.
   * @returns The pending requests.
   */
  @Get('friend-requests')
  @ApiOperation({ summary: 'List pending friend requests' })
  @ApiOkResponse({
    description: 'The pending requests.',
    type: [FriendRequestDto],
  })
  findRequests(
    @UserId() userId: string,
    @Query() query: FriendRequestsQueryDto,
  ): Promise<FriendRequestDto[]> {
    return this._friendshipService.findRequests(
      userId,
      query.direction ?? FriendRequestDirection.INCOMING,
    );
  }

  /**
   * Sends a friend request.
   *
   * @param userId - The authenticated user's ID.
   * @param dto - The recipient's username.
   * @returns The pending request, or the friendship when the request completed
   *   a mutual pair.
   */
  @Post('friend-requests')
  @ApiOperation({ summary: 'Send a friend request' })
  @ApiOkResponse({ description: 'The request, or the resulting friendship.' })
  @ApiBadRequestResponse({ description: 'The caller addressed themselves.' })
  @ApiForbiddenResponse({ description: 'A block stands between the members.' })
  @ApiNotFoundResponse({ description: 'No public record matches.' })
  @ApiConflictResponse({
    description: 'A request or friendship already exists.',
  })
  sendRequest(
    @UserId() userId: string,
    @Body() dto: CreateFriendRequestDto,
  ): Promise<FriendRequestDto | FriendDto> {
    return this._friendshipService.sendRequest(userId, dto);
  }

  /**
   * Accepts a friend request addressed to the caller.
   *
   * @param userId - The authenticated user's ID.
   * @param friendshipId - The request to accept.
   * @returns The resulting friendship.
   */
  @Post('friend-requests/:friendshipId/accept')
  @ApiOperation({ summary: 'Accept a friend request' })
  @ApiOkResponse({ description: 'The friendship.', type: FriendDto })
  @ApiNotFoundResponse({ description: 'The caller has no such request.' })
  acceptRequest(
    @UserId() userId: string,
    @Param('friendshipId', ParseUUIDPipe) friendshipId: string,
  ): Promise<FriendDto> {
    return this._friendshipService.acceptRequest(userId, friendshipId);
  }

  /**
   * Declines a friend request addressed to the caller.
   *
   * @param userId - The authenticated user's ID.
   * @param friendshipId - The request to decline.
   */
  @Post('friend-requests/:friendshipId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Decline a friend request' })
  @ApiNoContentResponse({ description: 'The request was declined.' })
  @ApiNotFoundResponse({ description: 'The caller has no such request.' })
  declineRequest(
    @UserId() userId: string,
    @Param('friendshipId', ParseUUIDPipe) friendshipId: string,
  ): Promise<void> {
    return this._friendshipService.declineRequest(userId, friendshipId);
  }

  /**
   * Withdraws a request the caller sent.
   *
   * @param userId - The authenticated user's ID.
   * @param friendshipId - The request to withdraw.
   */
  @Delete('friend-requests/:friendshipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a sent friend request' })
  @ApiNoContentResponse({ description: 'The request was withdrawn.' })
  @ApiNotFoundResponse({ description: 'The caller has no such request.' })
  cancelRequest(
    @UserId() userId: string,
    @Param('friendshipId', ParseUUIDPipe) friendshipId: string,
  ): Promise<void> {
    return this._friendshipService.cancelRequest(userId, friendshipId);
  }

  // ----- Blocks -----

  /**
   * Lists the members the caller has blocked.
   *
   * @param userId - The authenticated user's ID.
   * @returns The caller's blocks.
   */
  @Get('blocks')
  @ApiOperation({ summary: 'List blocked members' })
  @ApiOkResponse({ description: 'The blocks.', type: [BlockedMemberDto] })
  findBlockedMembers(@UserId() userId: string): Promise<BlockedMemberDto[]> {
    return this._blockService.findBlockedMembers(userId);
  }

  /**
   * Blocks a member.
   *
   * @param userId - The authenticated user's ID.
   * @param dto - The member to block and an optional private note.
   * @returns The block.
   */
  @Post('blocks')
  @ApiOperation({ summary: 'Block a member' })
  @ApiOkResponse({ description: 'The block.', type: BlockedMemberDto })
  @ApiBadRequestResponse({ description: 'The caller addressed themselves.' })
  @ApiNotFoundResponse({ description: 'No active member matches.' })
  blockMember(
    @UserId() userId: string,
    @Body() dto: CreateBlockDto,
  ): Promise<BlockedMemberDto> {
    return this._blockService.blockMember(userId, dto);
  }

  /**
   * Lifts a block.
   *
   * @param userId - The authenticated user's ID.
   * @param blockId - The block to lift.
   */
  @Delete('blocks/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unblock a member' })
  @ApiNoContentResponse({ description: 'The block was lifted.' })
  @ApiNotFoundResponse({ description: 'The caller has no such block.' })
  unblockMember(
    @UserId() userId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ): Promise<void> {
    return this._blockService.unblockMember(userId, blockId);
  }
}
