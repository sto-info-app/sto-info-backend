import { ApiProperty } from '@nestjs/swagger';

import { ReaderChapterStatus } from '../../enums/reader-chapter-status.enum';

/**
 * A reader's progress through one Chapter.
 *
 * Returned so the reader page can put somebody back where they left off. A
 * reader who has never opened the Chapter gets a row of nothings rather than a
 * 404: having no progress is an ordinary state, not a missing resource.
 */
export class ChapterProgressDto {
  @ApiProperty({ description: 'The Chapter.' })
  chapterId: string;

  @ApiProperty({
    enum: ReaderChapterStatus,
    description: 'Where the reader has got to.',
  })
  status: ReaderChapterStatus;

  @ApiProperty({
    description: 'How far through the Chapter the reader has read.',
    nullable: true,
  })
  progressPercent: number | null;

  @ApiProperty({
    description: 'The block anchor to resume at.',
    nullable: true,
    example: 'b12',
  })
  blockId: string | null;

  @ApiProperty({
    description: 'When the reader last opened the Chapter.',
    nullable: true,
  })
  lastReadAt: Date | null;
}
