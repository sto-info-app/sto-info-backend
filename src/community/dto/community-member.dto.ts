import { ApiProperty } from '@nestjs/swagger';

import { PublicMemberSummaryDto } from '../../shared/dto/public-member-summary.dto';

/**
 * The public face of a member as shown in a friend or blocked list.
 *
 * Carries exactly what the registry itself exposes — the username and avatar,
 * never the email, real name or user ID — so a friend list can never reveal
 * more about someone than their registry record already does.
 */
export class CommunityMemberDto extends PublicMemberSummaryDto {
  @ApiProperty({
    description:
      'Whether the member still has a public registry record. A friend who ' +
      'has since gone private stays in the list but can no longer be opened.',
    example: true,
  })
  publiclyVisible: boolean;
}
