import { ApiProperty } from '@nestjs/swagger';

import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';

/**
 * The largest collection any reorder can describe.
 *
 * The most items any one parent may hold is its Field ceiling, so nothing
 * legitimate exceeds that. Bounding it here stops a request from asking the
 * server to compare an unbounded list against a collection of ten.
 */
const MAX_REORDER_SIZE = CUSTOM_TRACKING_LIMITS.MAX_FIELDS_PER_TAB;

/**
 * Putting a collection into a new order.
 *
 * The whole ordered list of siblings, not one item and a position. A request
 * naming a single item and a number could ask for an order whose consequences
 * nobody can see — two items sharing a place, or an item put beyond its
 * collection — whereas a complete list either describes the collection exactly
 * or does not, and the mismatch says which.
 */
export class ReorderCustomTrackingDto {
  @ApiProperty({
    description:
      'Every live item in this group, in the order they should end up.',
    type: [String],
    example: [
      '2f1a5a9c-0a1e-4b3c-9c1e-1a2b3c4d5e6f',
      '7b8c9d0e-1f2a-4b3c-8d9e-0f1a2b3c4d5e',
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_REORDER_SIZE)
  @IsUUID('4', { each: true })
  orderedIds: string[];
}
