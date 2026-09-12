import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean } from 'class-validator';

/**
 * Pins or unpins one of the authenticated user's own STO accounts.
 */
export class UpdateAccountPinDto {
  @ApiProperty({
    description:
      'True to pin the account to the top of the owner’s list, false to unpin it.',
    example: true,
  })
  @IsBoolean()
  pinned: boolean;
}
