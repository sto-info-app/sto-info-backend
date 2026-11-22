import { ApiProperty } from '@nestjs/swagger';

import { IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Asks what already answers to a name on a platform.
 *
 * Called by the registration form before anything is written, so somebody
 * about to register a second record for a Fleet already in the directory
 * finds out while they can still change their mind. The same matches come
 * back on the registration response, because a preflight answer can be stale
 * by the time the form is submitted and the warning has to be true of what
 * was actually saved.
 *
 * The name is **not** trimmed. Matching folds case and nothing else — a
 * leading space is a real difference between two in-game names, and trimming
 * here would report a duplicate that is not one, which is the failure that
 * stops people trusting the warning at all.
 */
export class FindScopeDuplicatesDto {
  @ApiProperty({ description: 'The platform to look on.' })
  @IsUUID()
  readonly platformId: string;

  @ApiProperty({
    description: 'The name being registered, exactly as it was typed.',
    maxLength: 255,
  })
  @IsString()
  @MaxLength(255)
  readonly name: string;
}
