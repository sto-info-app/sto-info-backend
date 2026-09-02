import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { STORYTIME_IMAGE_ALT_MAX_LENGTH } from '../../constants/storytime-image.constants';
import { CreateArcDto } from './create-arc.dto';

/** Trims a string value, leaving anything else untouched for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Updates an Arc.
 *
 * Status stays absent: publishing and unpublishing are separate actions with
 * their own checks, and allowing status here would let an empty Arc be
 * published without meeting them.
 */
export class UpdateArcDto extends PartialType(CreateArcDto) {
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
      'Alternative text for the banner. Rejected when there is no banner to describe.',
    maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please describe what the banner shows' })
  @MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH)
  readonly bannerImageAlt?: string;

  @ApiPropertyOptional({
    description:
      'Alternative text for the profile image. Rejected when there is no profile image to describe.',
    maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please describe what the profile image shows' })
  @MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH)
  readonly profileImageAlt?: string;
}

/**
 * Names a Story to invite into, or offer to, an Arc.
 */
export class ArcStoryDto {
  @ApiProperty({ description: 'The Story.' })
  @IsUUID('4')
  readonly storyId: string;
}

/**
 * Reorders an Arc's reading order.
 */
export class ReorderArcStoriesDto {
  @ApiProperty({
    description:
      'Every agreed membership in the Arc, listed once each, in reading order.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  readonly membershipIds: string[];
}
