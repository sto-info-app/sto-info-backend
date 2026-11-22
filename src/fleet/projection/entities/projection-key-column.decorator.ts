import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

import { Column } from 'typeorm';

/**
 * Declares one of the keys a projection row is filed under — its Fleet, its
 * projection revision or its roster identity — as a required column.
 *
 * Every derived row carries the same three, because a revision is rebuilt and
 * read as a whole: the replay writes rows in bulk by Fleet and revision, and
 * the readers filter on the same columns.
 *
 * @param description - What the key names, for the API documentation.
 * @param type - The column type: `uuid` for a reference, `integer` for the
 *   revision number.
 * @returns The combined property decorator.
 */
export function ProjectionKeyColumn(
  description: string,
  type: 'uuid' | 'integer',
): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ description }),
    Column({ type, nullable: false }),
  );
}
