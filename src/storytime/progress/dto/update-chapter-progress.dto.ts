import { ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * A block anchor as stamped by the Markdown renderer.
 *
 * Constrained so a client cannot store arbitrary text in a field the reader
 * page will later look up as an element id.
 */
const BLOCK_ANCHOR_PATTERN = /^b[0-9]{1,6}$/;

/**
 * Reports how far a reader has got through a Chapter.
 *
 * Sent repeatedly while somebody reads, so it is deliberately small and
 * idempotent: the same body twice leaves the same result.
 */
export class UpdateChapterProgressDto {
  @ApiPropertyOptional({
    description: 'How far through the Chapter the reader has read.',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  readonly progressPercent?: number;

  @ApiPropertyOptional({
    description:
      'The block anchor the reader last reached, as stamped on the rendered content.',
    example: 'b12',
  })
  @IsOptional()
  @IsString()
  @Matches(BLOCK_ANCHOR_PATTERN, {
    message: 'blockId must be a rendered block anchor, such as b12',
  })
  readonly blockId?: string;
}
