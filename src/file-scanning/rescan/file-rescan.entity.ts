import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { RescanState } from './rescan.enums';

/**
 * One picture's rescan (FC-041): the copy staged for the worker, what it was
 * asked against, and the verdict. Nothing here names a file or its owner.
 */
@Entity({ name: 'file_rescan' })
export class FileRescanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  campaignId: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column({
    type: 'enum',
    enum: RescanState,
    enumName: 'file_rescan_state_enum',
    default: RescanState.REQUESTED,
  })
  state: RescanState;

  /** Where the copy was staged in the quarantine bucket. */
  @Column({ type: 'varchar', length: 300 })
  stagingKey: string;

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ type: 'varchar', length: 100 })
  declaredContentType: string;

  @Column({ type: 'integer' })
  policyVersion: number;

  /** The signature version the worker reported when this was asked for. */
  @Column({ type: 'varchar', length: 255 })
  definitionEpoch: string;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  rejectionCode: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  engine: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  engineVersion: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  signatureVersion: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  verdictAt: Date | null;
}
