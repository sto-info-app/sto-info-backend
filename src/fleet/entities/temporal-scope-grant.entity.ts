import { ApiProperty } from '@nestjs/swagger';

import { Column, JoinColumn, ManyToOne } from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { ScopeAccessRecordEntity } from './scope-access-record.entity';

/**
 * Something granted at a scope for a period: a role label, or a capability.
 *
 * Grants are temporal rather than deleted, so "who could approve that
 * application last March" stays answerable after one has been withdrawn.
 * Each records who made the change and why.
 */
export abstract class TemporalScopeGrantEntity extends ScopeAccessRecordEntity {
  @ApiProperty({ description: 'When it took effect.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  validFrom: Date;

  @ApiProperty({
    description: 'When it ended, or null while it stands.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  validTo: Date | null;

  @ApiProperty({ description: 'Who made the change.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  grantedByUserId: string | null;

  @ApiProperty({
    description: 'Why it was granted or withdrawn.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'grantedByUserId' })
  grantedBy: UserEntity | null;
}
