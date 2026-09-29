import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * A conversation between two people (FC-031), lower user ID first.
 *
 * Whether they may use it — friends, neither blocking the other — is asked
 * at every read and post, never stored.
 */
@Entity({ name: 'chat_direct_conversation' })
@Unique('UQ_chat_direct_conversation_pair', ['userLowId', 'userHighId'])
@Index('IDX_chat_direct_conversation_high', ['userHighId'])
export class ChatDirectConversationEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  userLowId: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  userHighId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /**
   * When the lower-ID person was last told of a message here while away;
   * null once they have opened it since (FC-033).
   */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  lowNoticedAt: Date | null;

  /** The same, for the higher-ID person. */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  highNoticedAt: Date | null;
}
