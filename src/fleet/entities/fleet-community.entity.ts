import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeEntity } from './fleet-scope.entity';

/**
 * An organisation that owns Fleets and Armadas on STO Info.
 *
 * This is *not* `src/community`, which is the personal social graph of
 * friendships and blocks. See ADR-0008: anything named `Community` outside
 * `src/fleet` means the social graph, and this class is deliberately called
 * `FleetCommunity` so the two cannot be confused at an import.
 *
 * Exactly one owner is maintained by the column being single-valued. The
 * owner reference is `SET NULL` rather than `CASCADE`, and a CHECK lets only
 * a closed Community have none (FC-038): deleting the account behind a live
 * Community fails loudly rather than quietly taking every Fleet, Armada and
 * roster history with it, so an Owner who closes their account hands each
 * open Community to an Admin, or closes it, first.
 *
 * Instants are `timestamptz` throughout — ADR-0007.
 *
 * The lifecycle, artwork, revision and date columns every scope carries
 * come from {@link FleetScopeEntity}.
 */
@Entity({ name: 'fleet_community' })
@Index('UX_fleet_community_slug', ['slug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_fleet_community_owner', ['ownerUserId'])
export class FleetCommunityEntity extends FleetScopeEntity {
  @ApiProperty({
    description:
      'The user who owns this Community, or null for a closed one whose ' +
      'Owner’s account has been erased (FC-038).',
    nullable: true,
    type: String,
  })
  @Column({ type: 'uuid', nullable: true })
  ownerUserId: string | null;

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

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'ownerUserId' })
  owner: UserEntity | null;
}
