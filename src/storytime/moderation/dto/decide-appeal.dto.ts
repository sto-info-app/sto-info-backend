import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Decides an appeal.
 *
 * Upholding restores the content in the same act, so an administrator cannot
 * agree with a creator and then leave their work down.
 */
export class DecideAppealDto {
  @ApiProperty({
    description: 'Whether the appeal succeeds and the content comes back.',
  })
  @IsBoolean()
  readonly uphold: boolean;

  @ApiProperty({
    description:
      'What the creator is told, shown to them word for word. Required, and ' +
      'kept in the site admin log (FC-039).',
    maxLength: 1000,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  readonly reviewNotes: string;
}
