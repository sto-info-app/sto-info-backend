import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ModerationHoldActionKind } from './moderation-hold.enums';

/**
 * What was done to a hold, and every reading of what it keeps, with the
 * reason or purpose (FC-036). Write-once by trigger.
 */
@Entity({ name: 'moderation_hold_action' })
@Index('IDX_moderation_hold_action_hold', ['holdId', 'createdAt'])
export class ModerationHoldActionEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  holdId: string;

  @ApiProperty({ enum: ModerationHoldActionKind })
  @Column({
    type: 'enum',
    enum: ModerationHoldActionKind,
    enumName: 'moderation_hold_action_kind_enum',
  })
  action: ModerationHoldActionKind;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ description: 'Why, or for a reading, its purpose.' })
  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'jsonb', nullable: true, default: null })
  detail: Record<string, unknown> | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'For an entry a job or scheduled run wrote, the key that keeps a ' +
      'retry from writing it twice (FC-039).',
  })
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  idempotencyKey: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
