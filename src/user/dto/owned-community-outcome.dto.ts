import { ApiProperty } from '@nestjs/swagger';

import { OwnedCommunityOutcome } from '../account-departure';

/** What closing the account does to one Community the user owns (FC-038). */
export class OwnedCommunityOutcomeDto implements OwnedCommunityOutcome {
  @ApiProperty()
  communityId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    enum: ['TRANSFER', 'CLOSE'],
    description:
      'Handed to its longest-serving Admin who can take it, or closed when ' +
      'none can.',
  })
  outcome: 'TRANSFER' | 'CLOSE';

  @ApiProperty({ nullable: true, type: String })
  toUserId: string | null;

  @ApiProperty({ nullable: true, type: String })
  toUsername: string | null;
}
