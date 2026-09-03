import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ReaderStoryStatus } from '../../enums/reader-story-status.enum';

/**
 * One reader's progress through one Story.
 *
 * `knownPublishedChapterCount` is what makes "new Chapters since you finished"
 * possible. It records how many published Chapters existed when the reader was
 * last up to date; when the Story has more than that, the reader has something
 * new waiting without anything having to be pushed to them.
 */
@Entity({ name: 'storytime_user_story_progress' })
@Index(['userId', 'status'])
export class StorytimeUserStoryProgressEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The reader.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({ description: 'The Story being read.' })
  @Column({ type: 'uuid', nullable: false })
  storyId: string;

  @ApiProperty({
    enum: ReaderStoryStatus,
    description: 'Where the reader has got to.',
  })
  @Column({
    type: 'enum',
    enum: ReaderStoryStatus,
    enumName: 'storytime_reader_story_status_enum',
    default: ReaderStoryStatus.NOT_STARTED,
  })
  status: ReaderStoryStatus;

  @ApiProperty({
    description: 'The Chapter the reader was last in.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  lastReadChapterId: string | null;

  @ApiProperty({
    description: 'When the reader first made meaningful progress.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  startedAt: Date | null;

  @ApiProperty({
    description: 'When the reader finished every published Chapter.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  completedAt: Date | null;

  @ApiProperty({
    description: 'When the reader last read any Chapter of this Story.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  lastReadAt: Date | null;

  @ApiProperty({ description: 'How many Chapters the reader has finished.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  completedChapterCount: number;

  @ApiProperty({
    description:
      'How many published Chapters existed when the reader was last up to date. A Story with more than this has new content for them.',
  })
  @Column({ type: 'integer', nullable: false, default: 0 })
  knownPublishedChapterCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
