import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ReportStatus } from '../../../moderation/enums/report-status.enum';
import { StorytimeReportReason } from '../../enums/storytime-report-reason.enum';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/**
 * A reader's report about a piece of Storytime content.
 *
 * A report is a message to the site's administrators and is only ever read in
 * the moderation queue. The creator is never told who reported them, and a
 * report never removes anything by itself: somebody decides.
 *
 * A reporter may hold one live report per item, so the queue cannot be flooded
 * with the same complaint. Resolving it frees them to report the same item
 * again about something new.
 */
@Entity({ name: 'storytime_report' })
@Index(['status', 'createdAt'])
@Index(['targetType', 'targetId'])
export class StorytimeReportEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The member who raised the report.' })
  @Column({ type: 'uuid', nullable: false })
  reporterUserId: string;

  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of content was reported.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeTargetType,
    enumName: 'storytime_target_type_enum',
  })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The content reported.' })
  @Column({ type: 'uuid', nullable: false })
  targetId: string;

  @ApiProperty({
    enum: StorytimeReportReason,
    description: 'The policy category the reporter chose.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeReportReason,
    enumName: 'storytime_report_reason_enum',
  })
  reasonCode: StorytimeReportReason;

  @ApiProperty({
    description: 'The reporter’s own account of the problem.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 2000, nullable: true, default: null })
  description: string | null;

  @ApiProperty({
    enum: ReportStatus,
    description: 'Where the report sits in the queue.',
  })
  @Column({
    type: 'enum',
    enum: ReportStatus,
    enumName: 'report_status_enum',
    default: ReportStatus.OPEN,
  })
  status: ReportStatus;

  @ApiProperty({
    description: 'The administrator who claimed it.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  assignedToUserId: string | null;

  @ApiProperty({
    description: 'What the administrator decided, for the record.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  resolution: string | null;

  @ApiProperty({ description: 'When it was resolved.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
