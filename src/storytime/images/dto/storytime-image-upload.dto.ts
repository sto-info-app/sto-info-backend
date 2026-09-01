import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { STORYTIME_IMAGE_ALT_MAX_LENGTH } from '../../constants/storytime-image.constants';

/** Trims a string value, leaving anything else untouched for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The text fields accompanying an uploaded image.
 *
 * Alternative text is required rather than optional. An image without it is
 * simply absent to a reader using a screen reader, and the moment somebody has
 * just cropped a picture is the only moment they are certainly looking at it
 * and can say what it shows. Asking later means never being told.
 */
export class StorytimeImageUploadDto {
  @ApiProperty({
    description: 'What the image shows, for readers who cannot see it.',
    maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please describe what the image shows' })
  @MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH)
  readonly altText: string;
}
