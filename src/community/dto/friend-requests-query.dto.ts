import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional } from 'class-validator';

import { FriendRequestDirection } from '../enums/friend-request-direction.enum';

/**
 * Query parameters accepted by the pending friend-request listing.
 */
export class FriendRequestsQueryDto {
  @ApiPropertyOptional({
    enum: FriendRequestDirection,
    description: 'Which way the requests point. Defaults to INCOMING.',
    default: FriendRequestDirection.INCOMING,
  })
  @IsOptional()
  @IsEnum(FriendRequestDirection)
  readonly direction?: FriendRequestDirection;
}
