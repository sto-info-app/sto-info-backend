import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { StorytimeModerationAction } from '../../enums/storytime-moderation-action.enum';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/**
 * One entry in the moderation audit trail.
 *
 * Append-only: there is no update column and no soft delete, because a record
 * that can be edited answers "what do we say happened" rather than "what
 * happened". Removing and restoring the same Story produces two entries, never
 * one row whose meaning changes.
 *
 * It holds no foreign key to the content either. The history of a removal has
 * to outlive the content being deleted afterwards, which is exactly when
 * somebody asks about it.
 */
@Entity({ name: 'storytime_moderation_action' })
@Index(['targetType', 'targetId', 'createdAt'])
export class StorytimeModerationActionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of content was acted on.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeTargetType,
    enumName: 'storytime_target_type_enum',
  })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The content acted on.' })
  @Column({ type: 'uuid', nullable: false })
  targetId: string;

  @ApiProperty({
    enum: StorytimeModerationAction,
    description: 'What was done.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeModerationAction,
    enumName: 'storytime_moderation_action_enum',
  })
  action: StorytimeModerationAction;

  @ApiProperty({ description: 'The administrator who did it.' })
  @Column({ type: 'uuid', nullable: false })
  actorUserId: string;

  @ApiProperty({ description: 'The policy code cited.', nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  reasonCode: string | null;

  @ApiProperty({
    description: 'What was said to the creator, recorded verbatim.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  message: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
