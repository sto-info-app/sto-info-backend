import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One Character copied from one Story into another (sc-1483).
 *
 * The Security Log reads it as its Storytime source: who copied whom, from
 * which Story into which, and when. Written in the transaction that saves
 * the copy, and write-once by trigger except that the actor goes when their
 * account does. Kept under the audit policy, like the site admin log.
 *
 * The Characters and Stories are named by identifier alone, with no foreign
 * key, so the record outlives either Character being deleted.
 */
@Entity({ name: 'storytime_character_copy' })
@Index('IDX_storytime_character_copy_created', ['createdAt'])
export class StorytimeCharacterCopyEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'Who made the copy, until their account goes.',
    nullable: true,
    type: String,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ description: 'The Character that was copied.' })
  @Column({ type: 'uuid' })
  sourceCharacterId: string;

  @ApiProperty({ description: 'The Story it was copied from.' })
  @Column({ type: 'uuid' })
  sourceStoryId: string;

  @ApiProperty({ description: 'The Character the copy made.' })
  @Column({ type: 'uuid' })
  copyCharacterId: string;

  @ApiProperty({ description: 'The Story it was copied into.' })
  @Column({ type: 'uuid' })
  targetStoryId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
