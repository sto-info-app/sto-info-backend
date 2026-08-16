import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { CreateArcDto } from './create-arc.dto';

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
