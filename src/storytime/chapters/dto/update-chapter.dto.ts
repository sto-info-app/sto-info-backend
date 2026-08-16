import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateChapterDto } from './create-chapter.dto';

/**
 * Updates a Chapter.
 *
 * Status stays absent: publishing, unpublishing and scheduling are separate
 * actions with their own checks, and allowing status here would let a Chapter
 * be published without meeting them.
 */
export class UpdateChapterDto extends PartialType(CreateChapterDto) {
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
