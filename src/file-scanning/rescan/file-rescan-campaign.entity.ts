import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { RescanCampaignKind, RescanCampaignState } from './rescan.enums';

/** Which pictures a campaign rescans. Every field narrows it. */
export interface RescanSelection {
  /** Kinds of picture, or every kind. */
  readonly kinds?: string[];
  /** Uploaded (registered) on or after, ISO 8601. */
  readonly uploadedFrom?: string;
  /** Uploaded before, ISO 8601. */
  readonly uploadedBefore?: string;
  /** Not scanned for this many days, or never. */
  readonly notScannedForDays?: number;
  /** Only legacy pictures, never scanned. */
  readonly unverifiedOnly?: boolean;
  /** Ahead of other campaigns, or behind; always behind new uploads. */
  readonly priority?: 'HIGH' | 'LOW';
}

/** What a campaign has done so far. */
export interface RescanCampaignCounts {
  readonly requested?: number;
  readonly clean?: number;
  readonly infected?: number;
  readonly refused?: number;
  readonly failed?: number;
  /** Already rescanned against these definitions by another campaign. */
  readonly skipped?: number;
}

/**
 * One rescan campaign (FC-041): a selection of published pictures, worked
 * through a batch at a time behind new uploads, with a cursor so it resumes
 * where it stopped.
 */
@Entity({ name: 'file_rescan_campaign' })
export class FileRescanCampaignEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: RescanCampaignKind,
    enumName: 'file_rescan_campaign_kind_enum',
  })
  kind: RescanCampaignKind;

  @Column({
    type: 'enum',
    enum: RescanCampaignState,
    enumName: 'file_rescan_campaign_state_enum',
    default: RescanCampaignState.RUNNING,
  })
  state: RescanCampaignState;

  /** The site admin, or null for the system's legacy campaign. */
  @Column({ type: 'uuid', nullable: true, default: null })
  startedByUserId: string | null;

  @Column({ type: 'jsonb', default: {} })
  selection: RescanSelection;

  @Column({ type: 'uuid', nullable: true, default: null })
  cursor: string | null;

  @Column({ type: 'jsonb', default: {} })
  counts: RescanCampaignCounts;

  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  finishedAt: Date | null;
}
