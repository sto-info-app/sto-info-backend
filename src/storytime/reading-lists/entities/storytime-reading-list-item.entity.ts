import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One thing on a reading list.
 *
 * Points at either a Story or an Arc and never both — the database enforces
 * that, so nothing downstream has to cope with an item that means two things or
 * nothing. Chapters are deliberately not listable: a list of chapters from
 * different Stories is a Story, and Storytime already has those.
 */
@Entity({ name: 'storytime_reading_list_item' })
@Index(['readingListId', 'orderIndex'])
export class StorytimeReadingListItemEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The list it is on.' })
  @Column({ type: 'uuid', nullable: false })
  readingListId: string;

  @ApiProperty({
    description: 'The Story listed, if it is one.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  storyId: string | null;

  @ApiProperty({ description: 'The Arc listed, if it is one.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  arcId: string | null;

  @ApiProperty({ description: 'Why it is on the list.', nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  note: string | null;

  @ApiProperty({ description: 'Where it comes in the order.' })
  @Column({ type: 'int', nullable: false, default: 0 })
  orderIndex: number;

  @ApiProperty({ description: 'When it was added.' })
  @CreateDateColumn()
  createdAt: Date;
}
