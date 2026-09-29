import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { AuditIdentifiersOnly } from 'src/audit/audit-redaction';

import { ChatTranscriptStatus } from '../enums/chat.enums';

/**
 * A scope admin's transcript of one channel (FC-035): at most the last seven
 * days, with a purpose, written to the private exports bucket and
 * downloadable for 24 hours.
 */
@AuditIdentifiersOnly()
@Entity({ name: 'chat_transcript' })
@Index('IDX_chat_transcript_requester', ['requestedByUserId', 'createdAt'])
export class ChatTranscriptEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  channelId: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  requestedByUserId: string | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 500 })
  purpose: string;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  fromAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  toAt: Date;

  @ApiProperty({ enum: ChatTranscriptStatus })
  @Column({
    type: 'enum',
    enum: ChatTranscriptStatus,
    enumName: 'chat_transcript_status_enum',
    default: ChatTranscriptStatus.PENDING,
  })
  status: ChatTranscriptStatus;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  objectKey: string | null;

  @ApiProperty({ nullable: true, type: Number })
  @Column({ type: 'integer', nullable: true, default: null })
  messageCount: number | null;

  @ApiProperty({ nullable: true, type: Number })
  @Column({ type: 'integer', nullable: true, default: null })
  byteCount: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  readyAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  expiresAt: Date | null;
}
