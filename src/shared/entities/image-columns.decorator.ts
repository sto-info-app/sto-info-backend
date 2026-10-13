import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

import { Column } from 'typeorm';

/** Widest image reference a slot column holds. */
export const IMAGE_REFERENCE_COLUMN_LENGTH = 160;

/** Widest alternative text a slot column holds. */
export const IMAGE_ALT_TEXT_COLUMN_LENGTH = 300;

/**
 * Declares the column holding an optional image's delivery reference.
 *
 * Every artwork slot — a Story's banner, a Fleet's emblem — stores the same
 * two things, a reference and its description, at the same widths. Declaring
 * them here keeps those widths in one place, so two slots cannot drift apart.
 *
 * @param description - What the image is, for the API documentation.
 * @returns The combined property decorator.
 */
export function ImageReferenceColumn(description: string): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ description, nullable: true }),
    Column({
      type: 'varchar',
      length: IMAGE_REFERENCE_COLUMN_LENGTH,
      nullable: true,
      default: null,
    }),
  );
}

/**
 * Declares the column holding an optional image's alternative text.
 *
 * @param description - What the text describes, for the API documentation.
 * @returns The combined property decorator.
 */
export function ImageAltTextColumn(description: string): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ description, nullable: true }),
    Column({
      type: 'varchar',
      length: IMAGE_ALT_TEXT_COLUMN_LENGTH,
      nullable: true,
      default: null,
    }),
  );
}
