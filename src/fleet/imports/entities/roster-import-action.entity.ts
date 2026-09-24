import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { RosterImportActionKind } from '../enums/roster-import-action-kind.enum';
import { RosterImportConflictEntity } from './roster-import-conflict.entity';
import { RosterImportSourceEntity } from './roster-import-source.entity';

/**
 * What a correction said, beyond which import and why.
 *
 * Only the kinds that need more than that carry any: the lines a row
 * exclusion named, and the zone and instant a timezone correction replaced.
 */
export interface RosterImportActionDetail {
  /** The sanitised file's lines the action named, header as line one. */
  readonly lines?: readonly number[];
  /** The zone the import was read through before. */
  readonly fromTimezone?: string | null;
  /** The zone it is read through now. */
  readonly toTimezone?: string;
  /** The export instant before, as ISO 8601. */
  readonly fromExportedAt?: string | null;
  /** The export instant now, as ISO 8601. */
  readonly toExportedAt?: string;
}

/**
 * One thing an investigator did to a roster import (FC-019).
 *
 * Append-only: a database trigger refuses any change but the actor's
 * account being deleted. The import's own columns hold where it now stands;
 * this is how it got there, who moved it and why, which plan section 3.6
 * requires of every exclusion and correction.
 */
@Entity({ name: 'fleet_roster_import_action' })
@Index('IDX_roster_import_action_import', ['importSourceId', 'actedAt'])
@Index('IDX_roster_import_action_fleet', ['fleetId', 'actedAt'])
@Index('IDX_roster_import_action_conflict', ['conflictGroupId'])
@Index('IDX_roster_import_action_actor', ['actorUserId'])
export class RosterImportActionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Fleet, carried for tenancy.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The import acted on.' })
  @Column({ type: 'uuid', nullable: false })
  importSourceId: string;

  @ApiProperty({
    description: 'For a selection, the group it settled; otherwise null.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  conflictGroupId: string | null;

  @ApiProperty({
    enum: RosterImportActionKind,
    description: 'What was done.',
  })
  @Column({
    type: 'enum',
    enum: RosterImportActionKind,
    enumName: 'roster_import_action_enum',
    nullable: false,
  })
  action: RosterImportActionKind;

  @ApiProperty({
    description: 'Who did it, or null once their account is gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({ description: 'Why, in their own words. Always given.' })
  @Column({ type: 'varchar', length: 500, nullable: false })
  reason: string;

  @ApiProperty({
    description: 'The lines, or the zone and instant, the action changed.',
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true, default: null })
  detail: RosterImportActionDetail | null;

  @ApiProperty({ description: 'When it was done.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  actedAt: Date;

  @ApiProperty({ description: 'When the row was written.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => RosterImportSourceEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'importSourceId' })
  importSource: RosterImportSourceEntity;

  @ManyToOne(() => RosterImportConflictEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'conflictGroupId' })
  conflictGroup: RosterImportConflictEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actor: UserEntity | null;
}
