import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { SiteAdminActionKind } from './site-admin-action.enum';

/**
 * One site-level admin action (FC-039): who, when, whom or what, why and
 * the relevant IDs, written in the transaction that makes the change.
 * Write-once by trigger, but for the accounts it names going and its IP
 * address being forgotten; kept under the audit policy.
 */
@Entity({ name: 'site_admin_action' })
@Index('IDX_site_admin_action_created', ['createdAt'])
@Index('IDX_site_admin_action_target', ['targetUserId'])
export class SiteAdminActionEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: SiteAdminActionKind })
  @Column({
    type: 'enum',
    enum: SiteAdminActionKind,
    enumName: 'site_admin_action_enum',
  })
  action: SiteAdminActionKind;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  targetUserId: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'What kind of record it acted on, when not an account.',
  })
  @Column({ type: 'varchar', length: 40, nullable: true, default: null })
  subjectKind: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  subjectId: string | null;

  @ApiProperty({
    description:
      'Why. Up to 1,000 characters: what a Storytime creator is told is ' +
      'the reason too.',
  })
  @Column({ type: 'varchar', length: 1000 })
  reason: string;

  @ApiProperty({
    nullable: true,
    description: 'What changed: codes, states and IDs, never content.',
  })
  @Column({ type: 'jsonb', nullable: true, default: null })
  detail: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 45, nullable: true, default: null })
  ipAddress: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
