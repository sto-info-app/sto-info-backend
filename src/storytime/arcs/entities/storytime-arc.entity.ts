import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { buildCloudflareImageUrl } from '../../../shared/constants/image.constants';
import { STORYTIME_IMAGE_VARIANTS } from '../../constants/storytime-image.constants';
import { ArcStatus } from '../../enums/arc-status.enum';
import { StorytimeModerationStatus } from '../../enums/storytime-moderation-status.enum';
import { StorytimeVisibility } from '../../enums/storytime-visibility.enum';

/**
 * An Arc: a reading order somebody has curated across several Stories.
 *
 * An Arc owns none of the Stories in it. Anybody may curate one, and inclusion
 * is agreed by both sides — which is what stops an Arc from being a way to
 * attach yourself to somebody else's work without asking.
 *
 * Slugs are unique across the site rather than scoped to an owner, because an
 * Arc is reached by its own address with no Story above it to disambiguate.
 */
@Entity({ name: 'storytime_arc' })
@Index(['ownerUserId', 'status'])
export class StorytimeArcEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The curator.' })
  @Column({ type: 'uuid', nullable: false })
  ownerUserId: string;

  @ApiProperty({ description: 'Arc title.' })
  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @ApiProperty({ description: 'URL-friendly identifier, unique site-wide.' })
  @Column({ type: 'varchar', length: 220, nullable: false })
  slug: string;

  @ApiProperty({
    description: 'Short summary shown on a card.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  shortDescription: string | null;

  @ApiProperty({
    description: 'The full description, authored as Markdown.',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true, default: null })
  description: string | null;

  @ApiProperty({
    description: 'Server-rendered, sanitised description.',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true, default: null })
  descriptionHtml: string | null;

  @ApiProperty({ enum: ArcStatus, description: 'Publication state.' })
  @Column({
    type: 'enum',
    enum: ArcStatus,
    enumName: 'storytime_arc_status_enum',
    default: ArcStatus.DRAFT,
  })
  status: ArcStatus;

  @ApiProperty({
    enum: StorytimeVisibility,
    description: 'Who may reach it once published.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeVisibility,
    enumName: 'storytime_visibility_enum',
    default: StorytimeVisibility.PRIVATE,
  })
  visibility: StorytimeVisibility;

  @ApiProperty({
    description: 'BCP 47 language the Arc is described in.',
  })
  @Column({ type: 'varchar', length: 10, nullable: false, default: 'en' })
  languageCode: string;

  @ApiProperty({
    description: 'Cloudflare Images ID for the banner.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  bannerImageId: string | null;

  @ApiProperty({
    description: 'Alternative text for the banner.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  bannerImageAlt: string | null;

  @ApiProperty({
    description: 'Cloudflare Images ID for the profile image.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  profileImageId: string | null;

  @ApiProperty({
    description: 'Alternative text for the profile image.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  profileImageAlt: string | null;

  @ApiProperty({
    description: 'When the Arc was first published.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  publishedAt: Date | null;

  @ApiProperty({ description: 'Thumbs Up count.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  upVoteCount: number;

  @ApiProperty({ description: 'Thumbs Down count.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  downVoteCount: number;

  @ApiProperty({
    enum: StorytimeModerationStatus,
    description: 'Whether an administrator has removed the Arc.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeModerationStatus,
    enumName: 'storytime_moderation_status_enum',
    default: StorytimeModerationStatus.ACTIVE,
  })
  moderationStatus: StorytimeModerationStatus;

  @ApiProperty({ description: 'When the Arc was removed.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  removedAt: Date | null;

  @ApiProperty({
    description: 'Administrator who removed the Arc.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  removedByUserId: string | null;

  @ApiProperty({
    description: 'Why the Arc was removed, as a policy code.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  moderationReasonCode: string | null;

  @ApiProperty({
    description: 'Explanation shown to the curator verbatim.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  moderationMessage: string | null;

  @ApiProperty({ description: 'When the Arc was restored.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  restoredAt: Date | null;

  @ApiProperty({
    description: 'Administrator who restored the Arc.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  restoredByUserId: string | null;

  @ApiProperty({ description: 'User who created the Arc.' })
  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  @ApiProperty({ description: 'User who last updated the Arc.' })
  @Column({ type: 'uuid', nullable: false })
  updatedByUserId: string;

  @ApiProperty({
    description: 'User who soft-deleted the Arc.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  deletedByUserId: string | null;

  @ApiProperty({
    description:
      'Optimistic-concurrency version, sent back on update so a stale edit is refused.',
  })
  @Column({ type: 'integer', nullable: false, default: 1 })
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;

  /**
   * Gets the banner URL at desktop size.
   *
   * @returns The image URL, or null when the Arc has no banner.
   */
  get bannerImageUrl(): string | null {
    return this.buildImageUrl(
      this.bannerImageId,
      STORYTIME_IMAGE_VARIANTS.BANNER_LARGE,
    );
  }

  /**
   * Gets the profile image URL.
   *
   * @returns The image URL, or null when the Arc has no profile image.
   */
  get profileImageUrl(): string | null {
    return this.buildImageUrl(
      this.profileImageId,
      STORYTIME_IMAGE_VARIANTS.PROFILE_LARGE,
    );
  }

  /**
   * Builds a Cloudflare Images URL for a stored image ID.
   *
   * @param imageId - The stored Cloudflare Images ID.
   * @param variant - The variant to request.
   * @returns The image URL, or null when no image is set.
   */
  private buildImageUrl(
    imageId: string | null,
    variant: string,
  ): string | null {
    if (!imageId) {
      return null;
    }

    return buildCloudflareImageUrl(imageId, variant);
  }
}
