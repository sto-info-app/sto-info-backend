import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from '../../user/entities/user.entity';
import { ReportReason } from '../enums/report-reason.enum';
import { ReportStatus } from '../enums/report-status.enum';

/**
 * One member's report of another member's conduct.
 *
 * Unlike a block, which is a private preference the blocked member never sees,
 * a report is a message to the site's administrators and is only ever read in
 * the admin queue. The reported member is never told who reported them.
 *
 * A reporter may hold only one live report against the same member at a time —
 * enforced by a partial unique index over the unresolved states — so the queue
 * cannot be flooded with duplicates of the same complaint. Resolving a report
 * frees the pair, letting a reporter raise a fresh report about new conduct.
 */
@Entity({ name: 'user_report' })
@Index(['reportedId'])
@Index(['reporterId'])
@Index(['status'])
export class UserReportEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The member who raised the report.' })
  @Column({ type: 'uuid', nullable: false })
  reporterId: string;

  @ApiProperty({ description: 'The member the report is about.' })
  @Column({ type: 'uuid', nullable: false })
  reportedId: string;

  @ApiProperty({
    description: 'The category the reporter chose.',
    enum: ReportReason,
    example: ReportReason.HARASSMENT,
  })
  @Column({
    type: 'enum',
    enum: ReportReason,
    enumName: 'report_reason_enum',
    nullable: false,
  })
  reason: ReportReason;

  @ApiPropertyOptional({
    description: "The reporter's own account of what happened.",
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  details: string | null;

  @ApiProperty({
    description: 'Where the report sits in the moderation queue.',
    enum: ReportStatus,
    example: ReportStatus.OPEN,
  })
  @Column({
    type: 'enum',
    enum: ReportStatus,
    enumName: 'report_status_enum',
    default: ReportStatus.OPEN,
  })
  status: ReportStatus;

  @ApiPropertyOptional({
    description: 'Internal notes left by the reviewing administrator.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 2000, nullable: true, default: null })
  moderatorNotes: string | null;

  @ApiPropertyOptional({
    description: 'The administrator who last changed the status.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  reviewedById: string | null;

  @ApiPropertyOptional({
    description: 'When the status was last changed.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  reviewedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporterId' })
  reporter: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reportedId' })
  reported: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reviewedById' })
  reviewedBy: UserEntity | null;
}
