import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetCommunityEntity } from './fleet-community.entity';

/**
 * A slug a Community, Fleet or Armada used to answer to.
 *
 * Fleets get linked from Discord and from forum posts, and those links outlive
 * any rename, so a renamed scope leaves its old address behind rather than
 * breaking it — ADR-0022. `StorytimeSlugHistoryEntity` does the same job for
 * Stories and this is deliberately shaped like it.
 *
 * A row is a fact about the past, so there is no `updatedAt` and no
 * `deletedAt`: nothing amends one, and removing one would un-reserve a name
 * that an old link still points at. They go only when the Community they
 * belong to is hard-deleted.
 *
 * `targetId` has no foreign key, because it addresses one of three tables.
 * `targetType` says which, and the pair is only ever resolved through the
 * service that wrote it.
 *
 * The parents are nullable because they mean different things per kind, and
 * the check constraint in the migration is what keeps that honest: a Community
 * row carries neither, since a Community slug is unique across the site; a
 * Fleet or Armada row carries both, since theirs is unique only within one
 * Community on one platform.
 */
@Entity({ name: 'fleet_slug_history' })
@Index('UX_fleet_slug_history_global', ['targetType', 'slug'], {
  unique: true,
  where: '"communityId" IS NULL',
})
@Index(
  'UX_fleet_slug_history_scoped',
  ['targetType', 'communityId', 'platformId', 'slug'],
  {
    unique: true,
    where: '"communityId" IS NOT NULL',
  },
)
@Index('IDX_fleet_slug_history_target', ['targetType', 'targetId'])
export class FleetSlugHistoryEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    enum: FleetScopeKind,
    description: 'Which kind of scope used this slug.',
  })
  @Column({
    type: 'enum',
    enum: FleetScopeKind,
    enumName: 'fleet_scope_kind_enum',
  })
  targetType: FleetScopeKind;

  @ApiProperty({ description: 'The scope that was renamed.' })
  @Column({ type: 'uuid', nullable: false })
  targetId: string;

  @ApiProperty({
    description: 'Owning Community, for a Fleet or Armada slug.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  communityId: string | null;

  @ApiProperty({
    description: 'Platform, for a Fleet or Armada slug.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  platformId: string | null;

  @ApiProperty({ description: 'The slug that is no longer in use.' })
  @Column({ type: 'varchar', length: 80, nullable: false })
  slug: string;

  @ApiProperty({ description: 'When the scope stopped using it.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  replacedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => FleetCommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: FleetCommunityEntity | null;

  @ManyToOne(() => PlatformEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'platformId' })
  platform: PlatformEntity | null;
}
