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

import { GeneralFactionEntity } from 'src/sto/character/entities/general-faction.entity';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { FleetCommunityEntity } from './fleet-community.entity';

/**
 * A Star Trek Online Fleet as STO Info records it.
 *
 * Deliberately **not** a tenant-wide claim on the real in-game Fleet. There is
 * no unique constraint on `(platformId, exactGameName)`, so two Communities may
 * each hold a record for a Fleet of the same name and neither is authoritative
 * — plan section 4.1, and FC-004's first acceptance criterion. Duplicates are
 * surfaced to people through `exactGameNameNormalized`, never merged
 * automatically.
 *
 * `communityId` is nullable so a roster can be held against an explicitly
 * confirmed unregistered observation target. Such a Fleet has no scoped URL and
 * no Armada placement: its slug index and the Armada composite foreign key both
 * require a Community.
 *
 * `exactGameName` is stored at 255 characters to match the existing
 * `character.handle` ceiling. That is storage headroom, **not** the naming rule
 * — ADR-0003 is still a proposal and whatever it settles on is enforced in the
 * application, so ruling either way needs no migration.
 */
@Entity({ name: 'sto_fleet' })
@Index('UX_sto_fleet_community_slug', ['communityId', 'platformId', 'slug'], {
  unique: true,
  where: '"deletedAt" IS NULL AND "communityId" IS NOT NULL',
})
@Index('IDX_sto_fleet_platform_name', ['platformId', 'exactGameNameNormalized'])
@Index('IDX_sto_fleet_community', ['communityId'])
export class StoFleetEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'Owning Community, or null for an unregistered record.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  communityId: string | null;

  @ApiProperty({ description: 'The platform the Fleet exists on.' })
  @Column({ type: 'uuid', nullable: false })
  platformId: string;

  /**
   * Allegiance, from the existing general faction reference data.
   *
   * Nullable and never guessed. Plan section 4.1 is explicit that faction
   * compatibility comes from master data, not from inferring it out of a CSV
   * Class column.
   */
  @ApiProperty({ description: 'Allegiance, if known.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  allegianceFactionId: string | null;

  @ApiProperty({ description: 'The Fleet name exactly as it appears in game.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  exactGameName: string;

  /**
   * Case-folded name, for finding duplicates rather than preventing them.
   *
   * Indexed non-uniquely with the platform. FC-013 uses it to warn a registrant
   * that a record already exists; it must never become a unique constraint.
   */
  @ApiProperty({ description: 'Case-folded name, for duplicate detection.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  exactGameNameNormalized: string;

  /**
   * Lowercase URL segment, unique within the Community *and* platform.
   *
   * The platform is part of the key because it is part of the canonical URL —
   * ADR-0022. One Community may hold a Fleet called the same thing on PC and
   * on Xbox, and both keep the readable slug rather than the second one being
   * suffixed to avoid a collision that only existed in the index.
   */
  @ApiProperty({
    description: 'Lowercase URL segment, unique per Community and platform.',
  })
  @Column({ type: 'varchar', length: 80, nullable: false })
  slug: string;

  @ApiProperty({
    enum: FleetRecruitmentState,
    description: 'Whether and how the Fleet accepts applications.',
  })
  @Column({
    type: 'enum',
    enum: FleetRecruitmentState,
    enumName: 'fleet_recruitment_state_enum',
    default: FleetRecruitmentState.CLOSED,
  })
  recruitmentState: FleetRecruitmentState;

  @ApiProperty({
    enum: FleetAudience,
    description: 'Who may see the Fleet record.',
  })
  @Column({
    type: 'enum',
    enum: FleetAudience,
    enumName: 'fleet_audience_enum',
    default: FleetAudience.COMMUNITY,
  })
  visibility: FleetAudience;

  /**
   * Export instant of the most recent import chosen as effective.
   *
   * A cached answer to "how current is this roster", maintained by the import
   * workflow in FC-017. It is not evidence and nothing is derived from it.
   */
  @ApiProperty({
    description: 'Export instant of the newest effective roster import.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  lastEffectiveImportAt: Date | null;

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  @Column({
    type: 'enum',
    enum: FleetScopeStatus,
    enumName: 'fleet_scope_status_enum',
    default: FleetScopeStatus.ACTIVE,
  })
  status: FleetScopeStatus;

  @ApiProperty({ description: 'When the Fleet was closed.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  closedAt: Date | null;

  @ApiProperty({ description: 'Authorisation revision counter.' })
  @Column({ type: 'integer', nullable: false, default: 1 })
  revision: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => FleetCommunityEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'communityId' })
  community: FleetCommunityEntity | null;

  @ManyToOne(() => PlatformEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'platformId' })
  platform: PlatformEntity;

  @ManyToOne(() => GeneralFactionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'allegianceFactionId' })
  allegianceFaction: GeneralFactionEntity | null;
}
