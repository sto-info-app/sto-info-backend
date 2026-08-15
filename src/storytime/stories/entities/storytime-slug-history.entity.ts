import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/**
 * A slug a Storytime entity used to have.
 *
 * Fan fiction gets linked from forums, Discord and Reddit, and those links
 * outlive any rename. A row is written whenever a slug changes so the old
 * address keeps working: a request matching one of these redirects
 * permanently to the entity's current URL rather than returning a dead page.
 *
 * Redirecting rather than serving content at the old address is deliberate. It
 * lets search engines consolidate on one canonical URL instead of treating the
 * two as duplicates.
 *
 * A new entity may not claim a slug that appears here. Without that rule an old
 * link could silently start resolving to somebody else's unrelated Story, which
 * is worse than the dead link the table exists to prevent.
 *
 * Rows are kept indefinitely. They are small, and their entire value is
 * longevity.
 */
@Entity({ name: 'storytime_slug_history' })
@Index(['targetType', 'targetId'])
export class StorytimeSlugHistoryEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'The kind of entity the slug belonged to.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeTargetType,
    enumName: 'storytime_target_type_enum',
  })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The entity the slug belonged to.' })
  @Column({ type: 'uuid', nullable: false })
  targetId: string;

  @ApiProperty({
    description:
      'The Story the slug was scoped to. Null for Story and Arc slugs, which are unique across the site.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  storyId: string | null;

  @ApiProperty({ description: 'The slug that is no longer current.' })
  @Column({ type: 'varchar', length: 220, nullable: false })
  slug: string;

  @ApiProperty({ description: 'When the slug was replaced.' })
  @Column({ type: 'timestamp', nullable: false, default: () => 'now()' })
  replacedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
