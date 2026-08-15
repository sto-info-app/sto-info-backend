import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateStoryDto } from './create-story.dto';

/**
 * Updates a Story.
 *
 * Every field is optional, so a client may send only what changed. Status is
 * still absent: publishing, unpublishing and archiving are separate actions
 * with their own checks, and allowing status to be set here would let a Story
 * be published without meeting the publication rules.
 */
export class UpdateStoryDto extends PartialType(CreateStoryDto) {
  @ApiPropertyOptional({
    description:
      'The version the client last saw. When supplied and out of date the update is rejected rather than silently overwriting somebody else’s edit.',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly version?: number;
}
