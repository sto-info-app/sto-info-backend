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

import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { FleetCommunityEntity } from './fleet-community.entity';

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
export class StoArmadaEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  @Column({
    type: 'enum',
    enum: FleetScopeStatus,
    enumName: 'fleet_scope_status_enum',
    default: FleetScopeStatus.ACTIVE,
  })
  status: FleetScopeStatus;

  @ApiProperty({ description: 'When the Armada was closed.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  closedAt: Date | null;

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

  @ManyToOne(() => FleetCommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: FleetCommunityEntity;

  @ManyToOne(() => PlatformEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'platformId' })
  platform: PlatformEntity;
}
