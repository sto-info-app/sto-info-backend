import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StorytimeCommentStatus } from '../../enums/storytime-comment-status.enum';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/**
 * One comment on a Story, Chapter or Arc.
 *
 * Replies point at a parent, and only one level of them is allowed: a thread
 * that nests indefinitely becomes unreadable on a phone and unmoderatable
 * anywhere.
 *
 * A silenced comment keeps its row and changes status. Deleting it would take
 * its replies with it and leave the conversation full of holes.
 */
@Entity({ name: 'storytime_comment' })
@Index(['targetType', 'targetId', 'createdAt'])
@Index(['authorUserId', 'createdAt'])
export class StorytimeCommentEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of thing is being discussed.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeTargetType,
    enumName: 'storytime_target_type_enum',
  })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The thing being discussed.' })
  @Column({ type: 'uuid', nullable: false })
  targetId: string;

  @ApiProperty({ description: 'Who wrote it.' })
  @Column({ type: 'uuid', nullable: false })
  authorUserId: string;

  @ApiProperty({
    description: 'The comment being replied to, when this is a reply.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  parentCommentId: string | null;

  @ApiProperty({ description: 'What they said, as plain text.' })
  @Column({ type: 'varchar', length: 2000, nullable: false })
  body: string;

  @ApiProperty({
    enum: StorytimeCommentStatus,
    description: 'Whether it is shown, and who stopped it being shown.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeCommentStatus,
    enumName: 'storytime_comment_status_enum',
    default: StorytimeCommentStatus.VISIBLE,
  })
  status: StorytimeCommentStatus;

  @ApiProperty({
    description: 'When the author last changed it.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  editedAt: Date | null;

  @ApiProperty({
    description: 'What an administrator said about removing it.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  moderationMessage: string | null;

  @ApiProperty({
    description: 'Who hid or removed it.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  moderatedByUserId: string | null;

  @ApiProperty({ description: 'When that happened.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  moderatedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
