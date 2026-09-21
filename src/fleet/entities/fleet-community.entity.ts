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

import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';

/**
 * An organisation that owns Fleets and Armadas on STO Info.
 *
 * This is *not* `src/community`, which is the personal social graph of
 * friendships and blocks. See ADR-0008: anything named `Community` outside
 * `src/fleet` means the social graph, and this class is deliberately called
 * `FleetCommunity` so the two cannot be confused at an import.
 *
 * Exactly one owner is maintained by the column being single-valued, and the
 * owner reference is `RESTRICT` rather than `CASCADE`: deleting the account
 * behind a live Community must fail loudly and force an ownership transfer
 * first, rather than quietly taking every Fleet, Armada and roster history with
 * it. Account erasure therefore has to transfer or close first, which is
 * FC-038's problem and is intentional.
 *
 * Instants are `timestamptz` throughout — ADR-0007.
 */
@Entity({ name: 'fleet_community' })
@Index('UX_fleet_community_slug', ['slug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_fleet_community_owner', ['ownerUserId'])
export class FleetCommunityEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The user who owns this Community.' })
  @Column({ type: 'uuid', nullable: false })
  ownerUserId: string;

  @ApiProperty({ description: 'Display name, as the owner wrote it.' })
  @Column({ type: 'varchar', length: 120, nullable: false })
  name: string;

  /**
   * Lowercase URL segment. Unique among live Communities.
   *
   * Stored already lowercased, with a database check enforcing it, so that
   * case-insensitive lookup is a plain index hit rather than a `lower()` scan.
   * A rename mints a new slug and leaves a canonical redirect behind; it never
   * reassigns history, because the ID is what history points at.
   */
  @ApiProperty({ description: 'Lowercase URL segment, unique while live.' })
  @Column({ type: 'varchar', length: 80, nullable: false })
  slug: string;

  @ApiProperty({ description: 'Free-text description.', nullable: true })
  @Column({ type: 'varchar', length: 2000, nullable: true, default: null })
  description: string | null;

  @ApiProperty({
    enum: FleetRecruitmentState,
    description: 'Whether and how the Community accepts new subscribers.',
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
    description: 'Who may see the Community record.',
  })
  @Column({
    type: 'enum',
    enum: FleetAudience,
    enumName: 'fleet_audience_enum',
    default: FleetAudience.PUBLIC,
  })
  visibility: FleetAudience;

  /**
   * Default IANA zone for presenting this Community's dates.
   *
   * Presentation only. It is never used to interpret a roster export, which
   * carries its own export zone — plan section 3.4 and FC-006.
   */
  @ApiProperty({ description: 'Default IANA display timezone.' })
  @Column({ type: 'varchar', length: 64, nullable: false, default: 'UTC' })
  preferredTimezone: string;

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  @Column({
    type: 'enum',
    enum: FleetScopeStatus,
    enumName: 'fleet_scope_status_enum',
    default: FleetScopeStatus.ACTIVE,
  })
  status: FleetScopeStatus;

  @ApiProperty({
    description: 'When the Community was closed.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  closedAt: Date | null;

  /**
   * Bumped by any change that can affect what a member is allowed to see.
   *
   * Cache invalidation and socket revocation key off this. Service checks stay
   * authoritative even when invalidation lags — plan section 4.2.
   */
  @ApiProperty({
    description: 'Delivery reference of the wide banner.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 160, nullable: true, default: null })
  bannerImageId: string | null;

  @ApiProperty({
    description: 'What the banner shows, for readers who cannot see it.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  bannerImageAlt: string | null;

  @ApiProperty({
    description: 'Delivery reference of the square emblem.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 160, nullable: true, default: null })
  emblemImageId: string | null;

  @ApiProperty({
    description: 'What the emblem shows, for readers who cannot see it.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  emblemImageAlt: string | null;

  @ApiProperty({ description: 'Authorisation revision counter.' })
  @Column({ type: 'integer', nullable: false, default: 1 })
  revision: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ownerUserId' })
  owner: UserEntity;
}
