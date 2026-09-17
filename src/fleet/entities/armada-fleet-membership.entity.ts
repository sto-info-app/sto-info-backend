import { ApiProperty } from '@nestjs/swagger';

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

import { UserEntity } from 'src/user/entities/user.entity';

import { ArmadaMembershipSource } from '../enums/armada-membership-source.enum';
import { ArmadaPosition } from '../enums/armada-position.enum';
import { FleetCommunityEntity } from './fleet-community.entity';
import { StoArmadaEntity } from './sto-armada.entity';
import { StoFleetEntity } from './sto-fleet.entity';

/**
 * A Fleet's place in an Armada over a stated interval.
 *
 * The association is temporal, so leaving an Armada closes the interval rather
 * than deleting the row: FC-004's third acceptance criterion requires the
 * historical link to survive both ownership transfer and closure, and a row
 * that is deleted on leaving cannot do that.
 *
 * Two invariants are enforced by the database rather than by a service, because
 * the acceptance criterion says "under concurrent writes" and two requests can
 * both pass a service check:
 *
 * - one open association per Fleet, by a partial unique index on `fleetId`
 *   where `validTo` is null;
 * - one open Alpha per Armada, by a partial unique index on `armadaId`
 *   restricted to that position.
 *
 * `communityId` is carried here so that both foreign keys can be composite,
 * against `(id, communityId)` on the Armada and on the Fleet. That makes a
 * cross-community placement structurally impossible rather than merely checked
 * — FC-004's fourth acceptance criterion. It has a deliberate consequence: a
 * Fleet with no Community, which is the unregistered observation target, cannot
 * be placed in an Armada, because no such row exists to reference.
 *
 * The remaining topology rules — no cycles, matching platform, compatible
 * intervals, and a Beta's Gammas being explicitly reparented or ended in the
 * same transaction when that Beta leaves — are service rules under an Armada
 * lock, and belong to FC-024.
 */
@Entity({ name: 'armada_fleet_membership' })
@Index('UX_armada_fleet_membership_open_fleet', ['fleetId'], {
  unique: true,
  where: '"validTo" IS NULL AND "deletedAt" IS NULL',
})
@Index('UX_armada_fleet_membership_open_alpha', ['armadaId'], {
  unique: true,
  where: `"position" = 'ALPHA' AND "validTo" IS NULL AND "deletedAt" IS NULL`,
})
@Index('IDX_armada_fleet_membership_armada_valid_from', [
  'armadaId',
  'validFrom',
])
@Index('IDX_armada_fleet_membership_parent', ['parentMembershipId'])
export class ArmadaFleetMembershipEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The Community both the Armada and the Fleet belong to.
   *
   * Denormalised on purpose: it is the second column of both composite foreign
   * keys, and it is what makes a cross-community reference fail at the database
   * rather than at a service that could be bypassed.
   */
  @ApiProperty({ description: 'The Community both records belong to.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({ description: 'The Armada.' })
  @Column({ type: 'uuid', nullable: false })
  armadaId: string;

  @ApiProperty({ description: 'The Fleet placed in it.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ enum: ArmadaPosition, description: 'Tier within the Armada.' })
  @Column({
    type: 'enum',
    enum: ArmadaPosition,
    enumName: 'armada_position_enum',
  })
  position: ArmadaPosition;

  /**
   * The association this one reports to.
   *
   * Null for an Alpha and required for a Beta or Gamma, enforced by a check
   * constraint. It points at the *association* rather than the Fleet, so
   * reparenting is a new row and the old parentage stays readable.
   */
  @ApiProperty({
    description: 'Parent association for a Beta or Gamma.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  parentMembershipId: string | null;

  @ApiProperty({ description: 'When the placement began.' })
  @Column({ type: 'timestamptz', nullable: false })
  validFrom: Date;

  @ApiProperty({
    description: 'When it ended, or null while current.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  validTo: Date | null;

  @ApiProperty({
    enum: ArmadaMembershipSource,
    description: 'How the placement was recorded.',
  })
  @Column({
    type: 'enum',
    enum: ArmadaMembershipSource,
    enumName: 'armada_membership_source_enum',
    default: ArmadaMembershipSource.MANUAL,
  })
  source: ArmadaMembershipSource;

  @ApiProperty({
    description: 'Why the placement was made or ended.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

  @ApiProperty({ description: 'When the record was entered.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  recordedAt: Date;

  @ApiProperty({ description: 'Who entered it.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  recordedByUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => FleetCommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: FleetCommunityEntity;

  /**
   * Joined on the Armada ID alone.
   *
   * The *constraint* is composite — `(armadaId, communityId)` against
   * `sto_armada (id, communityId)` — and lives in the migration. It is not
   * declared here because TypeORM would then have to own `communityId` inside
   * two separate relations as well as as a column, and the join it needs to
   * generate is the single-column one either way.
   */
  @ManyToOne(() => StoArmadaEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'armadaId' })
  armada: StoArmadaEntity;

  /** Joined on the Fleet ID alone; see {@link armada}. */
  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => ArmadaFleetMembershipEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parentMembershipId' })
  parentMembership: ArmadaFleetMembershipEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recordedByUserId' })
  recordedBy: UserEntity | null;
}
