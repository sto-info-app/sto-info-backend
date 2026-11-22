import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { AuditIdentifiersOnly } from 'src/audit/audit-redaction';

/**
 * One message, in a channel or a conversation (FC-031).
 *
 * Plain text. `clientMessageId` is unique per author, so a resend is the
 * same message. A deleted message keeps its row, and shows as deleted.
 */
@AuditIdentifiersOnly()
@Entity({ name: 'chat_message' })
@Unique('UQ_chat_message_client', ['authorUserId', 'clientMessageId'])
export class ChatMessageEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  channelId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  conversationId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  authorUserId: string | null;

  @ApiProperty()
  @Column({ type: 'uuid' })
  clientMessageId: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 2000 })
  body: string;

  @ApiProperty({ type: [String] })
  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  mentions: string[];

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  replyToMessageId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  deletedAt: Date | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  deletedByUserId: string | null;
}
