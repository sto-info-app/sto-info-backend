import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { ImageEstateStepState } from './image-estate.enums';

/** One row a copy repointed: which table, which column, which row. */
export interface ImageEstateReference {
  readonly table: string;
  readonly column: string;
  readonly rowId: string;
}

/**
 * One picture's copy to a private one (FC-040): what it was, what it became,
 * and every row it repointed, which is what undo puts back.
 */
@Entity({ name: 'image_estate_step' })
export class ImageEstateStepEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  runId: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column({
    type: 'enum',
    enum: ImageEstateStepState,
    enumName: 'image_estate_step_state_enum',
    default: ImageEstateStepState.PENDING,
  })
  state: ImageEstateStepState;

  /** The old public copy: a custom Cloudflare Images ID, or an R2 key. */
  @Column({ type: 'varchar', length: 200 })
  fromReference: string;

  @Column({
    type: 'enum',
    enum: FileAssetStorage,
    enumName: 'file_asset_storage_enum',
  })
  fromStorage: FileAssetStorage;

  /** The private copy, once uploaded. */
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  toReference: string | null;

  @Column({ type: 'char', length: 64, nullable: true, default: null })
  sha256: string | null;

  @Column({ type: 'integer', nullable: true, default: null })
  byteSize: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  detectedContentType: string | null;

  @Column({ type: 'jsonb', default: [] })
  references: ImageEstateReference[];

  /** The placements the copy made for rows that had none. */
  @Column({ type: 'jsonb', default: [] })
  placementIds: string[];

  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  copiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  undoneAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  retiredAt: Date | null;
}
