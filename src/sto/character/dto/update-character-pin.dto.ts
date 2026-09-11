import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean } from 'class-validator';

/**
 * Pins or unpins one of the captains on an account the authenticated user owns.
 */
export class UpdateCharacterPinDto {
  @ApiProperty({
    description:
      'True to pin the captain to the top of the account’s list, false to unpin it.',
    example: true,
  })
  @IsBoolean()
  pinned: boolean;
}
