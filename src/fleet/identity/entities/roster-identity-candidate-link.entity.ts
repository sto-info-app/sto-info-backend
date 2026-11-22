import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';

import { RosterIdentityAliasEntity } from './roster-identity-alias.entity';
import { RosterIdentityCandidateEntity } from './roster-identity-candidate.entity';

/**
 * One pair of aliases a rename candidate would join.
 *
 * A Character rename has exactly one: the name that vanished and the name
 * that appeared. An account rename has one per Character that moved from the
 * old handle to the new, which is how the number of corroborating alts is
 * counted and how confirming it joins every one of them at once.
 *
 * The recompute unions the links of every confirmed candidate to work out
 * which aliases share an identity, so these rows, and not the candidate's own
 * columns, are what a confirmation actually does.
 */
@Entity({ name: 'fleet_roster_identity_candidate_link' })
@Unique('UQ_roster_identity_candidate_link_to', ['candidateId', 'toAliasId'])
@Index('IDX_roster_identity_candidate_link_from', ['fromAliasId'])
@Index('IDX_roster_identity_candidate_link_to', ['toAliasId'])
export class RosterIdentityCandidateLinkEntity {
  @ApiProperty({ description: 'The candidate this pair belongs to.' })
  @PrimaryColumn({ type: 'uuid' })
  candidateId: string;

  @ApiProperty({ description: 'The Fleet, carried for tenancy.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'The alias that vanished.' })
  @PrimaryColumn({ type: 'uuid' })
  fromAliasId: string;

  @ApiProperty({ description: 'The alias that appeared.' })
  @Column({ type: 'uuid', nullable: false })
  toAliasId: string;

  @ManyToOne(
    () => RosterIdentityCandidateEntity,
    candidate => candidate.links,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'candidateId' })
  candidate: RosterIdentityCandidateEntity;

  @ManyToOne(() => RosterIdentityAliasEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'fromAliasId', referencedColumnName: 'id' },
    { name: 'fleetId', referencedColumnName: 'fleetId' },
  ])
  fromAlias: RosterIdentityAliasEntity;

  @ManyToOne(() => RosterIdentityAliasEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'toAliasId', referencedColumnName: 'id' },
    { name: 'fleetId', referencedColumnName: 'fleetId' },
  ])
  toAlias: RosterIdentityAliasEntity;
}
