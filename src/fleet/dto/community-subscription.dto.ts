import { ApiProperty } from '@nestjs/swagger';

import { FleetCommunityDto } from './fleet-community.dto';

/**
 * What following a Community looks like afterwards.
 *
 * The state rather than the record. A subscription row has a lifetime worth
 * keeping — it is how "followed once" stays answerable — but none of that is
 * the caller's business, and returning it would invite a client to hold an
 * identifier it has no route to use.
 *
 * Both fields are returned by both routes, so a page can redraw the control
 * and the count from one answer without asking again.
 */
export class CommunityFollowStateDto {
  @ApiProperty({ description: 'Whether the caller now follows the Community.' })
  isFollowing: boolean;

  @ApiProperty({ description: 'How many follow the Community now.' })
  followerCount: number;
}

/**
 * A Community the caller follows.
 *
 * The whole Community rather than a reference, because every surface that
 * shows this list shows a name, an emblem and an address. Asking for those
 * one at a time would be a request per row.
 */
export class FollowedCommunityDto {
  @ApiProperty({ type: FleetCommunityDto })
  community: FleetCommunityDto;

  @ApiProperty({ description: 'When the caller started following it.' })
  followedAt: Date;
}
