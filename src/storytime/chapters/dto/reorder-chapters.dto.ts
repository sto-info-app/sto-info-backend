import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/**
 * Reorders the Chapters of a Story.
 *
 * The whole sequence is sent rather than a single move, because the client
 * knows the order it wants and sending it outright removes any ambiguity.
 */
export class ReorderChaptersDto {
  @ApiProperty({
    description:
      'Every Chapter in the Story, listed once each, in reading order.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  readonly chapterIds: string[];
}
