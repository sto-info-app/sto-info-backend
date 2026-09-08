import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean } from 'class-validator';

/**
 * Marks a Chapter read or unread outright.
 */
export class SetChapterReadDto {
  @ApiProperty({
    description:
      'Whether the Chapter is now read. Marking it unread also clears the stored position.',
  })
  @IsBoolean()
  readonly isRead: boolean;
}
