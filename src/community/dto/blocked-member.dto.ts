import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommunityMemberDto } from './community-member.dto';

/**
 * A member the caller has blocked.
 *
 * Only ever returned to the blocker: the blocked member is never told, and no
 * endpoint exposes who has blocked them.
 */
export class BlockedMemberDto {
  @ApiProperty({ description: 'Block ID, used to unblock.' })
  id: string;

  @ApiProperty({ description: 'The blocked member.' })
  member: CommunityMemberDto;

  @ApiProperty({ description: 'When the block was created.' })
  blockedAt: Date;

  @ApiPropertyOptional({
    description: "The blocker's private note, if they left one.",
    nullable: true,
  })
  reason: string | null;
}
