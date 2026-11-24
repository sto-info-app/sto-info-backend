import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AuditIdentifiersOnly } from 'src/audit/audit-redaction';
import {
  ImageAltTextColumn,
  ImageReferenceColumn,
} from 'src/shared/entities/image-columns.decorator';
import { UserEntity } from 'src/user/entities/user.entity';

import {
  LOG_HEADLINE_MAX_LENGTH,
  LOG_REMOVAL_REASON_MAX_LENGTH,
  LogEntryType,
} from '../captains-log.constants';

/**
 * Reads PostgreSQL's numeric, which arrives as text, as a number.
 */
export const NUMERIC_TRANSFORMER = {
  to: (value: number): number => value,
  from: Number,
};

/**
 * One entry in a member's Captain's Log (sc-1450).
 *
 * The entry's words are the member's own, so the audit trail records only
 * which entry changed, never what it says.
 */
@AuditIdentifiersOnly()
@Entity({ name: 'log_entry' })
export class LogEntryEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The member who wrote the entry.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({ description: 'Captain’s or Personal.', enum: LogEntryType })
  @Column({
    type: 'enum',
    enum: LogEntryType,
    enumName: 'log_entry_type_enum',
    nullable: false,
  })
  type: LogEntryType;

  @ApiPropertyOptional({
    description: 'The headline the author gave, or null for the stardate one.',
    nullable: true,
  })
  @Column({
    type: 'varchar',
    length: LOG_HEADLINE_MAX_LENGTH,
    nullable: true,
    default: null,
  })
  headline: string | null;

  @ApiProperty({ description: 'The entry, in Markdown.' })
  @Column({ type: 'text', nullable: false })
  body: string;

  @ApiProperty({ description: 'The stardate it was written on, in UTC.' })
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: false,
    transformer: NUMERIC_TRANSFORMER,
  })
  stardate: number;

  @ImageReferenceColumn('The cleared picture, or null.')
  pictureId: string | null;

  @ImageAltTextColumn('What the picture shows, or null.')
  pictureAlt: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ApiPropertyOptional({
    description: 'When the author last edited it, or null.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  editedAt: Date | null;

  @ApiPropertyOptional({
    description: 'When a site admin removed it, or null.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  removedAt: Date | null;

  @ApiPropertyOptional({
    description: 'The site admin who removed it, or null.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  removedByUserId: string | null;

  @ApiPropertyOptional({
    description: 'Why a site admin removed it, or null.',
    nullable: true,
  })
  @Column({
    type: 'varchar',
    length: LOG_REMOVAL_REASON_MAX_LENGTH,
    nullable: true,
    default: null,
  })
  removedReason: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;
}
