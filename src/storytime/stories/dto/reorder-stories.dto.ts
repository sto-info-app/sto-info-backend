import { ApiProperty } from '@nestjs/swagger';

import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/**
 * Reorders the caller's Stories.
 *
 * The whole collection is sent rather than a single move, because the client
 * knows the order it wants and sending it outright removes any ambiguity about
 * what the result should be.
 */
export class ReorderStoriesDto {
  @ApiProperty({
    description:
      'Every Story the caller owns, listed once each, in the order they should appear.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  readonly storyIds: string[];
}
