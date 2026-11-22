import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ModerationHoldKind } from './moderation-hold.enums';

/**
 * A site admin's hold on evidence (FC-036): a chat report's, or everything
 * one member wrote in chat, kept past its ordinary deletion until released.
 * One live hold per report and per member.
 */
@Entity({ name: 'moderation_hold' })
export class ModerationHoldEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: ModerationHoldKind })
  @Column({
    type: 'enum',
    enum: ModerationHoldKind,
    enumName: 'moderation_hold_kind_enum',
  })
  kind: ModerationHoldKind;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  chatReportId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  subjectUserId: string | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  ownerUserId: string | null;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  reviewAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  releasedAt: Date | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  releasedByUserId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  releaseReason: string | null;
}
