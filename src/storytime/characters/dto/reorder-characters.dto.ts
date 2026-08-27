import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/**
 * Reorders the cast of a Story.
 *
 * The whole sequence is sent rather than a single move, because the client
 * knows the order it wants and sending it outright removes any ambiguity.
 */
export class ReorderCharactersDto {
  @ApiProperty({
    description:
      'Every Character in the Story, listed once each, in display order.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  readonly characterIds: string[];
}
