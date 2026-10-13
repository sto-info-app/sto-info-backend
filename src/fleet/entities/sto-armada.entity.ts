import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { GeneralFactionEntity } from 'src/sto/character/entities/general-faction.entity';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { FleetCommunityEntity } from './fleet-community.entity';
import { FleetScopeEntity } from './fleet-scope.entity';

/**
 * A Star Trek Online Armada as a Community records it.
 *
 * Unlike a Fleet, an Armada always belongs to a Community: nothing observes an
 * Armada, because STO roster exports carry no Armada information whatsoever
 * (plan section 3.2). Every Armada here was entered by a person, which is why
 * ADR-0004 rules out any derived topology in v1.
 *
 * The Armada holds no Fleet columns. Which Fleets are in it, in what position
 * and over what interval, is `armada_fleet_membership` — so a Fleet can leave
 * without either record being rewritten.
 *
 * The lifecycle, artwork, revision and date columns every scope carries
 * come from {@link FleetScopeEntity}.
 */
@Entity({ name: 'sto_armada' })
@Index('UX_sto_armada_community_slug', ['communityId', 'platformId', 'slug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_sto_armada_platform_name', [
  'platformId',
  'exactGameNameNormalized',
])
export class StoArmadaEntity extends FleetScopeEntity {
  @ApiProperty({ description: 'Owning Community.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({ description: 'The platform the Armada exists on.' })
  @Column({ type: 'uuid', nullable: false })
  platformId: string;

  @ApiProperty({
    description: 'The Armada name exactly as it appears in game.',
  })
  @Column({ type: 'varchar', length: 255, nullable: false })
  exactGameName: string;

  @ApiProperty({ description: 'Case-folded name, for duplicate detection.' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  exactGameNameNormalized: string;

  /**
   * What the Community prefers to call it, when that differs from the game.
   *
   * Kept apart from `exactGameName` so a friendly label can never drift into
   * the field that has to match what the game shows.
   */
  @ApiProperty({ description: 'Community display label.', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  displayName: string | null;

  /**
   * Allegiance: Federation or Klingon, from the general faction reference
   * data (FC-024). A Fleet must share it to be placed here.
   *
   * Nullable only for an Armada registered before it existed; every
   * registration now sets it, and an Armada without one accepts no Fleet. It
   * cannot change while a Fleet is placed.
   */
  @ApiProperty({ description: 'Allegiance, if set.', nullable: true })
  @Column({ type: 'uuid', nullable: true, default: null })
  allegianceFactionId: string | null;

  /**
   * Lowercase URL segment, unique within the Community *and* platform.
   *
   * Scoped the same way a Fleet's is, and for the same reason — ADR-0022. An
   * Armada's canonical URL carries its platform too.
   */
  @ApiProperty({
    description: 'Lowercase URL segment, unique per Community and platform.',
  })
  @Column({ type: 'varchar', length: 80, nullable: false })
  slug: string;

  @ManyToOne(() => FleetCommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: FleetCommunityEntity;

  @ManyToOne(() => PlatformEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'platformId' })
  platform: PlatformEntity;

  @ManyToOne(() => GeneralFactionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'allegianceFactionId' })
  allegianceFaction: GeneralFactionEntity | null;
}
