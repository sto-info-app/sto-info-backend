import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ReaderChapterStatus } from '../../enums/reader-chapter-status.enum';

/**
 * One reader's progress through one Chapter.
 *
 * Position is stored as a block anchor rather than a scroll offset. The
 * anchors are stamped on every block by the Markdown renderer, so a stored
 * position survives a re-render, a different screen size and a change of font
 * — none of which a pixel offset does.
 */
@Entity({ name: 'storytime_user_chapter_progress' })
@Index(['userId', 'chapterId'])
export class StorytimeUserChapterProgressEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The reader.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({ description: 'The Chapter being read.' })
  @Column({ type: 'uuid', nullable: false })
  chapterId: string;

  @ApiProperty({ description: 'The Story the Chapter belongs to.' })
  @Column({ type: 'uuid', nullable: false })
  storyId: string;

  @ApiProperty({
    enum: ReaderChapterStatus,
    description: 'Where the reader has got to.',
  })
  @Column({
    type: 'enum',
    enum: ReaderChapterStatus,
    enumName: 'storytime_reader_chapter_status_enum',
    default: ReaderChapterStatus.UNREAD,
  })
  status: ReaderChapterStatus;

  @ApiProperty({
    description: 'What kind of position lastPositionValue holds.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 30, nullable: true, default: null })
  lastPositionType: string | null;

  @ApiProperty({
    description: 'The block anchor the reader last reached.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  lastPositionValue: string | null;

  @ApiProperty({
    description: 'How far through the Chapter the reader has read.',
    nullable: true,
  })
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    default: null,
    transformer: {
      /**
       * Stores a percentage.
       *
       * @param value - The percentage to store.
       * @returns The value to write.
       */
      to: (value: number | null) => value,
      /**
       * Reads a percentage back as a number.
       *
       * Postgres returns `numeric` as a string to avoid losing precision, so
       * without this the API would emit "42.00" where a number is expected.
       *
       * @param value - The stored value.
       * @returns The percentage as a number, or null.
       */
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  progressPercent: number | null;

  @ApiProperty({
    description: 'When the reader first made meaningful progress.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  startedAt: Date | null;

  @ApiProperty({
    description: 'When the reader finished the Chapter.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  readAt: Date | null;

  @ApiProperty({
    description: 'When the reader last opened the Chapter.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  lastReadAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
