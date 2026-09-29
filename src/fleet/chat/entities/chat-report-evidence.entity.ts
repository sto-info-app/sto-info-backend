import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

import { AuditIdentifiersOnly } from 'src/audit/audit-redaction';

/**
 * One message kept as evidence for a report (FC-035): the reported message
 * at position 0, and the twenty before it, copied when reported so they
 * outlive the ordinary purge.
 */
@AuditIdentifiersOnly()
@Entity({ name: 'chat_report_evidence' })
@Unique('UQ_chat_report_evidence_position', ['reportId', 'position'])
export class ChatReportEvidenceEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  reportId: string;

  @ApiProperty({ description: '0 for the reported message, then back.' })
  @Column({ type: 'smallint' })
  position: number;

  @ApiProperty()
  @Column({ type: 'uuid' })
  messageId: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  authorUserId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  authorUsername: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Null for a message deleted before the report.',
  })
  @Column({ type: 'varchar', length: 2000, nullable: true, default: null })
  body: string | null;

  @ApiProperty()
  @Column({ type: 'boolean' })
  deleted: boolean;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  sentAt: Date;
}
