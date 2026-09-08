import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Credits somebody on a Story.
 *
 * The scope is expressed by what is named rather than by a separate field:
 * naming neither a Chapter nor a Character credits the whole Story, naming a
 * Chapter credits that Chapter, and naming a Character credits that Character
 * — optionally within one Chapter, which is how a voice credit for a single
 * scene is recorded.
 */
export class CreateCrewCreditDto {
  @ApiProperty({ description: 'The member being credited.' })
  @IsUUID('4')
  readonly userId: string;

  @ApiProperty({ description: 'The role they are credited in.' })
  @IsUUID('4')
  readonly roleId: string;

  @ApiPropertyOptional({
    description: 'The Chapter, when the credit is for one in particular.',
  })
  @IsOptional()
  @IsUUID('4')
  readonly chapterId?: string;

  @ApiPropertyOptional({
    description: 'The Character, when the credit is for one in particular.',
  })
  @IsOptional()
  @IsUUID('4')
  readonly characterId?: string;

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

  // Required as soon as there is an end, because a credit that stops applying
  // without ever having started describes nothing.
  @ApiPropertyOptional({
    description:
      'The Chapter this credit starts applying from. Required when validToChapterId is set.',
  })
  @ValidateIf(
    dto =>
      dto.validToChapterId !== undefined ||
      dto.validFromChapterId !== undefined,
  )
  @IsUUID('4', {
    message:
      'validFromChapterId is required, and must be a Chapter, when validToChapterId is set',
  })
  readonly validFromChapterId?: string;

  @ApiPropertyOptional({
    description: 'The Chapter this credit stops applying after.',
  })
  @IsOptional()
  @IsUUID('4')
  readonly validToChapterId?: string;
}
