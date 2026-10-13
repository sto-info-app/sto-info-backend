import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { STORYTIME_IMAGE_ALT_MAX_LENGTH } from '../constants/storytime-image.constants';

/**
 * Trims a string value, leaving anything else untouched for the validators.
 *
 * @param params - The value being transformed.
 * @returns The trimmed string, or the value unchanged.
 */
export const trimArtworkAltText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Declares an optional field updating the alternative text of a work's
 * artwork, such as its banner or profile image.
 *
 * The image itself is set through the artwork endpoints rather than named
 * on an update, so a work can only ever point at an image this site was
 * given. Its description stays editable, because a wording that reads badly
 * is worth correcting without asking somebody to upload the picture again.
 *
 * The decorators are listed in the order stacked ones would apply, bottom
 * up, so the validation messages come out in the order they always have.
 *
 * @param slot - The artwork named in the documentation and the messages,
 *   such as `banner` or `profile image`.
 * @returns The combined property decorator.
 */
export function ArtworkAltTextProperty(slot: string): PropertyDecorator {
  return applyDecorators(
    MaxLength(STORYTIME_IMAGE_ALT_MAX_LENGTH),
    IsNotEmpty({ message: `Please describe what the ${slot} shows` }),
    IsString(),
    Transform(trimArtworkAltText),
    IsOptional(),
    ApiPropertyOptional({
      description: `Alternative text for the ${slot}. Rejected when there is no ${slot} to describe.`,
      maxLength: STORYTIME_IMAGE_ALT_MAX_LENGTH,
    }),
  );
}
