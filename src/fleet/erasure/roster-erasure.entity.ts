import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { AuditIdentifiersOnly } from 'src/audit/audit-redaction';

/** What one erasure changed, by kind. */
export interface RosterErasureCounts {
  /** Roster rows anonymised. */
  readonly observations?: number;
  /** Identity aliases anonymised. */
  readonly aliases?: number;
  /** Stored roster files deleted early. */
  readonly files?: number;
  /** Fleets replayed. */
  readonly fleets?: number;
}

/**
 * A verified erasure of one Character name and @handle from every Fleet's
 * roster (FC-038). Holds a keyed hash of the pair, never the pair, and the
 * pseudonym that replaces it; with the others it is the suppression list
 * every import is scrubbed against. Write-once by trigger.
 */
@AuditIdentifiersOnly()
@Entity({ name: 'roster_erasure' })
export class RosterErasureEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'HMAC-SHA256 of the normalised name and handle, as hex.',
  })
  @Column({ type: 'char', length: 64 })
  pairHash: string;

  @ApiProperty({ description: 'The handle that replaces theirs.' })
  @Column({ type: 'varchar', length: 40 })
  pseudonym: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  adminUserId: string | null;

  @ApiProperty({
    description: 'Whether it was re-applied from the ledger after a restore.',
  })
  @Column({ type: 'boolean', default: false })
  replayed: boolean;

  @ApiProperty()
  @Column({ type: 'jsonb', default: () => "'{}'" })
  counts: RosterErasureCounts;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
