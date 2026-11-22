import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ImageEstateRunKind, ImageEstateRunState } from './image-estate.enums';

/** What a run has done so far. */
export interface ImageEstateRunCounts {
  /** References with no registry row, registered as UNVERIFIED. */
  registered?: number;
  /** Pictures copied to a private one. */
  copied?: number;
  /** Pictures put back. */
  undone?: number;
  /** Old public copies deleted. */
  retired?: number;
  /** Pictures that could not be handled, left as they were. */
  failed?: number;
}

/**
 * One checkpointed run over the image estate (FC-040): a copy, an undo or a
 * retirement. One is open at a time; its cursor is the last asset handled,
 * so a pause or a crash resumes after it.
 */
@Entity({ name: 'image_estate_run' })
export class ImageEstateRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ImageEstateRunKind,
    enumName: 'image_estate_run_kind_enum',
  })
  kind: ImageEstateRunKind;

  @Column({
    type: 'enum',
    enum: ImageEstateRunState,
    enumName: 'image_estate_run_state_enum',
    default: ImageEstateRunState.RUNNING,
  })
  state: ImageEstateRunState;

  @Column({ type: 'uuid', nullable: true, default: null })
  startedByUserId: string | null;

  @Column({ type: 'uuid', nullable: true, default: null })
  cursor: string | null;

  @Column({ type: 'jsonb', default: {} })
  counts: ImageEstateRunCounts;

  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  finishedAt: Date | null;
}
