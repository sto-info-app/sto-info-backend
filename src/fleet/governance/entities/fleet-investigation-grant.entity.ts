import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A site admin's read-only look at one Fleet's imports, for 24 hours, with a
 * purpose (FC-036). The row is the record: write-once by trigger.
 */
@Entity({ name: 'fleet_investigation_grant' })
@Index('IDX_fleet_investigation_grant_admin', [
  'adminUserId',
  'fleetId',
  'expiresAt',
])
export class FleetInvestigationGrantEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  communityId: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  fleetId: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  adminUserId: string | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 500 })
  purpose: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;
}
