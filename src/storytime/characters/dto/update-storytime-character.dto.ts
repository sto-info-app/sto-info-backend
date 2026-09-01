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
import { CreateStorytimeCharacterDto } from './create-storytime-character.dto';

/** Trims a string value, leaving anything else untouched for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Updates a Character.
 */
export class UpdateStorytimeCharacterDto extends PartialType(
  CreateStorytimeCharacterDto,
) {
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
      'Alternative text for the portrait. Rejected when there is no portrait to describe.',
    maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please describe what the portrait shows' })
  @MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH)
  readonly portraitImageAlt?: string;
}
