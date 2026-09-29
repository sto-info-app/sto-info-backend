import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { AuditIdentifiersOnly } from 'src/audit/audit-redaction';
import { ReportReason } from 'src/moderation/enums/report-reason.enum';
import { ReportStatus } from 'src/moderation/enums/report-status.enum';

/**
 * A reader's report of a chat message (FC-035), for the site's admins alone,
 * once per person per message.
 */
@AuditIdentifiersOnly()
@Entity({ name: 'chat_message_report' })
@Unique('UQ_chat_message_report_once', ['messageId', 'reporterUserId'])
@Index('IDX_chat_message_report_status', ['status', 'createdAt'])
export class ChatMessageReportEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  messageId: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  channelId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  conversationId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  reporterUserId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  authorUserId: string | null;

  @ApiProperty({ enum: ReportReason })
  @Column({ type: 'enum', enum: ReportReason, enumName: 'report_reason_enum' })
  reason: ReportReason;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  details: string | null;

  @ApiProperty({ enum: ReportStatus })
  @Column({
    type: 'enum',
    enum: ReportStatus,
    enumName: 'report_status_enum',
    default: ReportStatus.OPEN,
  })
  status: ReportStatus;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  resolutionNote: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  resolvedByUserId: string | null;

  @ApiProperty({ nullable: true, type: Date })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
