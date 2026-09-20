import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { FileAssetPlacementState } from '../enums/file-asset-placement-state.enum';
import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';
import { FileAssetEntity } from './file-asset.entity';

/**
 * What the site is showing in one slot, and what is on its way to it.
 *
 * The registry knows that bytes exist and whether they may be served. It does
 * not know that they are a particular Story's banner, and until an upload is
 * asynchronous nothing needs it to: the old path uploaded to Cloudflare and
 * wrote the identifier onto the row in the same request. Now a verdict
 * arrives seconds or minutes later, in another process, with nothing in hand
 * but an asset identifier — and something has to say which row's column to
 * set.
 *
 * **It is a table rather than a column on each owning row.** Eight tables
 * would otherwise each grow a pending pointer, and the sweep that abandons
 * stale uploads would have to know about all eight. Here the answer to "what
 * is in flight" is one query, and the answer to "what does this slot show" is
 * the same query.
 *
 * **It is not the reference the page renders.** The owning row still holds
 * the Cloudflare Images identifier and that is still what a template reads.
 * This table exists so that an upload can be described before it has one, and
 * so that a delete can find the asset behind an identifier a page already
 * has.
 */
@Entity({ name: 'file_asset_placement' })
@Index('UX_file_asset_placement_pending', ['subject', 'subjectId', 'slot'], {
  unique: true,
  where: `"state" = 'PENDING'`,
})
@Index('UX_file_asset_placement_active', ['subject', 'subjectId', 'slot'], {
  unique: true,
  where: `"state" = 'ACTIVE'`,
})
@Index('IDX_file_asset_placement_asset', ['assetId'])
@Index('IDX_file_asset_placement_state', ['state'])
export class FileAssetPlacementEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The asset being placed. */
  @ApiProperty({ description: 'The asset being placed.' })
  @Column({ type: 'uuid', nullable: false })
  assetId: string;

  /**
   * The asset being placed.
   *
   * `RESTRICT`, because an asset row is evidence that bytes existed and is
   * never deleted — withdrawal is a state, not a delete. A cascade here would
   * make a placement row removable by a route that does not exist.
   */
  @ManyToOne(() => FileAssetEntity, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assetId' })
  asset?: FileAssetEntity;

  @ApiProperty({
    enum: FileAssetPlacementState,
    description: 'What became of this placement.',
  })
  @Column({
    type: 'enum',
    enum: FileAssetPlacementState,
    enumName: 'file_asset_placement_state_enum',
    nullable: false,
  })
  state: FileAssetPlacementState;

  @ApiProperty({
    enum: FileAssetSubject,
    description: 'The kind of record the picture belongs to.',
  })
  @Column({
    type: 'enum',
    enum: FileAssetSubject,
    enumName: 'file_asset_subject_enum',
    nullable: false,
  })
  subject: FileAssetSubject;

  /**
   * Which record of that kind.
   *
   * Text rather than `uuid`, and there is one reason for it: a Custom
   * Tracking picture is identified by its Field and the record it describes
   * together, written `fieldId:targetId`, because the row that will hold the
   * picture does not exist until the picture is published. Every other
   * subject puts a single primary key here.
   *
   * No foreign key, since it points at one of eleven tables. What stops it
   * pointing at nothing is that a placement is only ever written by a
   * publisher that has already loaded the record and established the caller
   * owns it.
   */
  @ApiProperty({ description: 'Which record the picture belongs to.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  subjectId: string;

  @ApiProperty({
    enum: FileAssetSlot,
    description: 'Which picture of that record this is.',
  })
  @Column({
    type: 'enum',
    enum: FileAssetSlot,
    enumName: 'file_asset_slot_enum',
    nullable: false,
  })
  slot: FileAssetSlot;

  /**
   * What the publisher will need and cannot work out for itself.
   *
   * Empty for nine of the eleven subjects, because a publisher normally needs
   * nothing beyond the record and the new identifier. Custom Tracking is the
   * exception: its alt text is typed alongside the file and validated at
   * ingress, and the row that stores it is not written until publication, so
   * it has nowhere else to wait.
   *
   * Deliberately small and deliberately not a general escape hatch. Anything
   * a feature would want to keep here permanently belongs in that feature's
   * own table.
   */
  @ApiProperty({
    description: 'What the publisher needs at publication.',
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true, default: null })
  detail: Record<string, unknown> | null;

  /** When the placement stopped being pending, whichever way it went. */
  @ApiProperty({ description: 'When the placement settled.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  settledAt: Date | null;

  @ApiProperty({ description: 'When the row was created.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'When the row was last changed.' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
