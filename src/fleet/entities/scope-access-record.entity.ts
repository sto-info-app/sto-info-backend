import {
  CreateDateColumn,
  DeleteDateColumn,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';

import { FleetCommunityEntity } from './fleet-community.entity';
import { ScopedRecordEntity } from './scoped-record.entity';
import { StoArmadaEntity } from './sto-armada.entity';
import { StoFleetEntity } from './sto-fleet.entity';

/**
 * A soft-deleted record of who may do what at one scope: a membership, a role
 * assignment or a capability grant.
 *
 * Because `communityId` is part of the composite foreign key to each child, a
 * request cannot smuggle another Community's Fleet or Armada into a record
 * for this Community: the row simply will not insert. That is FC-004's fourth
 * acceptance criterion, enforced structurally rather than by a service check.
 */
export abstract class ScopeAccessRecordEntity extends ScopedRecordEntity {
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
   * Joined on the Fleet ID alone.
   *
   * The constraint in the migration is the composite `(fleetId, communityId)`
   * against `sto_fleet (id, communityId)`; it is not declared here for the same
   * reason as in `armada_fleet_membership`. PostgreSQL's default `MATCH SIMPLE`
   * makes this exactly right: when `fleetId` is null the constraint stands
   * aside, and when it is set both columns are checked together.
   */
  @ManyToOne(() => StoFleetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity | null;

  /** Joined on the Armada ID alone; see {@link fleet}. */
  @ManyToOne(() => StoArmadaEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'armadaId' })
  armada: StoArmadaEntity | null;
}
