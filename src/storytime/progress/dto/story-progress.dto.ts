import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReaderStoryStatus } from '../../enums/reader-story-status.enum';

/**
 * A reader's progress through a Story, with the figures they are shown.
 */
export class StoryProgressDto {
  @ApiProperty({ description: 'The Story.' })
  readonly storyId: string;

  @ApiProperty({
    enum: ReaderStoryStatus,
    description: 'Where the reader has got to.',
  })
  readonly status: ReaderStoryStatus;

  @ApiProperty({ description: 'Published, readable Chapters right now.' })
  readonly totalChapters: number;

  @ApiProperty({ description: 'How many of those the reader has finished.' })
  readonly readChapters: number;

  @ApiProperty({ description: 'Whole percent complete.' })
  readonly percentComplete: number;

  @ApiProperty({
    description: 'Chapters published since the reader was last up to date.',
  })
  readonly newChapterCount: number;

  @ApiPropertyOptional({
    description:
      'Where Continue Reading should go: the first Chapter not yet finished.',
    nullable: true,
  })
  readonly continueChapterId: string | null;

  @ApiPropertyOptional({
    description: 'The Chapter the reader was last in.',
    nullable: true,
  })
  readonly lastReadChapterId: string | null;

  @ApiPropertyOptional({
    description: 'When the reader last read this Story.',
    nullable: true,
  })
  readonly lastReadAt: Date | null;

  @ApiPropertyOptional({
    description: 'When the reader finished it.',
    nullable: true,
  })
  readonly completedAt: Date | null;
}
