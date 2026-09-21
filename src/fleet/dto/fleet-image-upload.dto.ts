import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { FLEET_IMAGE_ALT_MAX_LENGTH } from '../constants/fleet-image.constants';

/** Trims a string value, leaving anything else untouched for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The text accompanying an uploaded banner or emblem.
 *
 * Required rather than optional, for the reason Storytime gives and the
 * database now enforces: a picture nobody described is simply absent to a
 * reader using a screen reader, and the moment somebody has just cropped one
 * is the only moment they are certainly looking at it.
 */
export class FleetImageUploadDto {
  @ApiProperty({
    description: 'What the image shows, for readers who cannot see it.',
    maxLength: FLEET_IMAGE_ALT_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please describe what the image shows' })
  @MaxLength(FLEET_IMAGE_ALT_MAX_LENGTH)
  readonly altText: string;
}
