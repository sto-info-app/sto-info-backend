import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional({
    description: 'What the creator is told, shown to them word for word.',
    maxLength: 1000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  readonly reviewNotes?: string;
}
