import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ReaderStoryStatus } from '../../enums/reader-story-status.enum';

/**
 * Sets a reader's own status for a Story.
 *
 * This is the reader's deliberate choice, and reading on afterwards will not
 * overwrite On hold or Abandoned.
 */
export class UpdateStoryProgressDto {
  @ApiProperty({
    enum: ReaderStoryStatus,
    description: 'The status the reader has chosen.',
  })
  @IsEnum(ReaderStoryStatus)
  readonly status: ReaderStoryStatus;
}
