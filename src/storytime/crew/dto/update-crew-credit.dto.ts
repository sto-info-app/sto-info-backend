import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Changes a credit's wording or notes.
 *
 * Who is credited, in what role, and against what are all absent. Changing any
 * of them makes it a different credit — one that would need checking for
 * duplicates and permission all over again — so that is a delete and an add
 * rather than an edit.
 */
export class UpdateCrewCreditDto {
  @ApiPropertyOptional({
    description: 'Wording to use instead of the role name.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  readonly creditLabel?: string;

  @ApiPropertyOptional({
    description: 'Notes shown with the credit.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  readonly notes?: string;
}
