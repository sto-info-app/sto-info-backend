import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FriendRequestDirection } from '../enums/friend-request-direction.enum';
import { RelationshipStatus } from '../enums/relationship-status.enum';
import { CommunityMemberDto } from './community-member.dto';

/**
 * An accepted friendship, from one member's point of view.
 */
export class FriendDto {
  @ApiProperty({ description: 'Friendship ID, used to unfriend.' })
  id: string;

  @ApiProperty({ description: 'The other member.' })
  member: CommunityMemberDto;

  @ApiPropertyOptional({
    description: 'When the request was accepted.',
    nullable: true,
  })
  friendsSince: Date | null;
}

/**
 * A friend request still awaiting a response.
 */
export class FriendRequestDto {
  @ApiProperty({ description: 'Friendship ID, used to respond or cancel.' })
  id: string;

  @ApiProperty({
    enum: FriendRequestDirection,
    description: 'Which way the request points, relative to the caller.',
  })
  direction: FriendRequestDirection;

  @ApiProperty({ description: 'The other member.' })
  member: CommunityMemberDto;

  @ApiProperty({ description: 'When the request was sent.' })
  requestedAt: Date;
}

/**
 * A page of accepted friendships.
 */
export class PaginatedFriendsDto {
  @ApiProperty({ type: [FriendDto] })
  items: FriendDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 12 })
  pageSize: number;
}

/**
 * Headline counts for the community navigation and request badge.
 */
export class CommunitySummaryDto {
  @ApiProperty({ example: 17 })
  friendCount: number;

  @ApiProperty({ example: 2 })
  incomingRequestCount: number;

  @ApiProperty({ example: 1 })
  outgoingRequestCount: number;

  @ApiProperty({ example: 0 })
  blockedCount: number;
}

/**
 * How the authenticated caller relates to a member they are viewing.
 */
export class RelationshipDto {
  @ApiProperty({ enum: RelationshipStatus })
  status: RelationshipStatus;

  @ApiPropertyOptional({
    description:
      'The friendship row behind this status, present for a pending request ' +
      'or an accepted friendship. Used to respond, cancel or unfriend.',
    nullable: true,
  })
  friendshipId: string | null;

  @ApiPropertyOptional({
    description: 'The block row behind a BLOCKED status, used to unblock.',
    nullable: true,
  })
  blockId: string | null;
}
