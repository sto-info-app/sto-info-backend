import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ImageInventoryRunState } from './image-estate.enums';

/**
 * One reconciliation of the image estate (FC-040): the feature tables'
 * references, the registry and Cloudflare's listing, counted against each
 * other. It reports; it deletes nothing.
 */
@Entity({ name: 'image_inventory_run' })
export class ImageInventoryRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ImageInventoryRunState,
    enumName: 'image_inventory_run_state_enum',
    default: ImageInventoryRunState.RUNNING,
  })
  state: ImageInventoryRunState;

  @Column({ type: 'uuid', nullable: true, default: null })
  startedByUserId: string | null;

  /** What it found: counts, and IDs only where it names anything. */
  @Column({ type: 'jsonb', nullable: true, default: null })
  report: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  finishedAt: Date | null;
}
