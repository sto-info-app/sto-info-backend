import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ChatActionKind } from '../enums/chat.enums';

/**
 * What a manager or moderator did in chat (FC-031).
 *
 * Write-once by trigger, but for the account and message it names going.
 */
@Entity({ name: 'chat_action' })
@Index('IDX_chat_action_channel', ['channelId', 'createdAt'])
export class ChatActionEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  channelId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  messageId: string | null;

  @ApiProperty({ enum: ChatActionKind })
  @Column({
    type: 'enum',
    enum: ChatActionKind,
    enumName: 'chat_action_kind_enum',
  })
  action: ChatActionKind;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

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
