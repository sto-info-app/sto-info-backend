import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { STORYTIME_IMAGE_ALT_MAX_LENGTH } from '../../constants/storytime-image.constants';
import { CreateChapterDto } from './create-chapter.dto';

/** Trims a string value, leaving anything else untouched for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Updates a Chapter.
 *
 * Status stays absent: publishing, unpublishing and scheduling are separate
 * actions with their own checks, and allowing status here would let a Chapter
 * be published without meeting them.
 */
export class UpdateChapterDto extends PartialType(CreateChapterDto) {
  @ApiPropertyOptional({
    description:
      'The version the client last saw. When supplied and out of date the update is rejected rather than overwriting somebody else’s edit.',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly version?: number;

  // The image itself is set through the artwork endpoints rather than named
  // here, so a work can only ever point at an image this site was given. Its
  // description stays editable, because a wording that reads badly is worth
  // correcting without asking somebody to upload the picture again.
  @ApiPropertyOptional({
    description:
      'Alternative text for the cover. Rejected when there is no cover to describe.',
    maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please describe what the cover shows' })
  @MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH)
  readonly coverImageAlt?: string;
}
