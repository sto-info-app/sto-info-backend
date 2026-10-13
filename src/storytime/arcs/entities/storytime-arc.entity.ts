import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index } from 'typeorm';

import { ArcStatus } from '../../enums/arc-status.enum';
import { StorytimePublishableWorkEntity } from '../../shared/entities/storytime-publishable-work.entity';

/**
 * An Arc: a reading order somebody has curated across several Stories.
 *
 * An Arc owns none of the Stories in it. Anybody may curate one, and inclusion
 * is agreed by both sides — which is what stops an Arc from being a way to
 * attach yourself to somebody else's work without asking.
 *
 * Slugs are unique across the site rather than scoped to an owner, because an
 * Arc is reached by its own address with no Story above it to disambiguate.
 *
 * The owner, title, description, artwork, moderation and audit columns are
 * shared with a Story through {@link StorytimePublishableWorkEntity}.
 */
@Entity({ name: 'storytime_arc' })
@Index(['ownerUserId', 'status'])
export class StorytimeArcEntity extends StorytimePublishableWorkEntity {
  @ApiProperty({ enum: ArcStatus, description: 'Publication state.' })
  @Column({
    type: 'enum',
    enum: ArcStatus,
    enumName: 'storytime_arc_status_enum',
    default: ArcStatus.DRAFT,
  })
  status: ArcStatus;

  @ApiProperty({
    description: 'BCP 47 language the Arc is described in.',
  })
  @Column({ type: 'varchar', length: 10, nullable: false, default: 'en-GB' })
  languageCode: string;

  @ApiProperty({
    description: 'Why the Arc was removed, as a policy code.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  moderationReasonCode: string | null;
}
