import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Sends a friend request to a member, identified the same way the registry
 * identifies them — by profile username, never by user ID.
 */
export class CreateFriendRequestDto {
  @ApiProperty({
    description: "The recipient's profile username.",
    example: 'captain.picard',
    maxLength: 50,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  readonly username: string;
}
