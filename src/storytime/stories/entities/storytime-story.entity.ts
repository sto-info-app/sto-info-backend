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
import { STORYTIME_DEFAULT_LANGUAGE_CODE } from '../../constants/storytime-language.constants';
import { CompletionState } from '../../enums/completion-state.enum';
import { ContentRating } from '../../enums/content-rating.enum';
import { StoryStatus } from '../../enums/story-status.enum';
import { StorytimeModerationStatus } from '../../enums/storytime-moderation-status.enum';
import { StorytimeVisibility } from '../../enums/storytime-visibility.enum';

/**
 * A Story: the container a creator publishes Chapters within.
 *
 * Three states are tracked separately and must not be conflated:
 *
 * - `status` is where the creator has got to (draft, published, archived);
 * - `visibility` is who may reach it once published;
 * - `moderationStatus` is whether an administrator has removed it.
 *
 * Keeping them apart is what allows a removed Story to be restored to exactly
 * the state its creator left it in, and stops a creator republishing their way
 * out of a moderation decision.
 */
@Entity({ name: 'storytime_story' })
@Index(['ownerUserId', 'ownerOrderIndex'])
export class StorytimeStoryEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The user who owns the Story.' })
  @Column({ type: 'uuid', nullable: false })
  ownerUserId: string;

  @ApiProperty({ description: 'Story title.' })
  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @ApiProperty({
    description: 'URL-friendly identifier, unique across all Stories.',
    example: 'the-long-way-home',
  })
  @Column({ type: 'varchar', length: 220, nullable: false })
  slug: string;

  @ApiProperty({
    description: 'Short plain-text summary used in listings.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  shortDescription: string | null;

  @ApiProperty({
    description: 'Full description, authored as Markdown.',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true, default: null })
  description: string | null;

  @ApiProperty({
    description:
      'Server-rendered, sanitised HTML for the description. Regenerated whenever the description changes.',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true, default: null })
  descriptionHtml: string | null;

  @ApiProperty({ enum: StoryStatus, description: 'Publication state.' })
  @Column({
    type: 'enum',
    enum: StoryStatus,
    enumName: 'storytime_story_status_enum',
    default: StoryStatus.DRAFT,
  })
  status: StoryStatus;

  @ApiProperty({
    enum: StorytimeVisibility,
    description: 'Who may reach the Story once published.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeVisibility,
    enumName: 'storytime_visibility_enum',
    default: StorytimeVisibility.PRIVATE,
  })
  visibility: StorytimeVisibility;

  @ApiProperty({
    enum: CompletionState,
    description: 'How finished the creator considers the whole work.',
  })
  @Column({
    type: 'enum',
    enum: CompletionState,
    enumName: 'storytime_completion_state_enum',
    default: CompletionState.ONGOING,
  })
  completionState: CompletionState;

  @ApiProperty({
    enum: ContentRating,
    description: 'The audience the Story is suitable for.',
  })
  @Column({
    type: 'enum',
    enum: ContentRating,
    enumName: 'storytime_content_rating_enum',
    default: ContentRating.GENERAL,
  })
  contentRating: ContentRating;

  @ApiProperty({
    description: 'BCP 47 language the Story is written in.',
    example: 'en',
  })
  @Column({
    type: 'varchar',
    length: 10,
    nullable: false,
    default: STORYTIME_DEFAULT_LANGUAGE_CODE,
  })
  languageCode: string;

  @ApiProperty({
    description:
      'Position within the owner Story collection. Gapped so a Story can be inserted between two others without renumbering.',
  })
  @Column({ type: 'integer', nullable: false })
  ownerOrderIndex: number;

  @ApiProperty({
    description: 'Cloudflare Images ID for the wide banner.',
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
    description: 'Cloudflare Images ID for the square profile image.',
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
    description: 'When the Story was first published.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  publishedAt: Date | null;

  @ApiProperty({
    description: 'When the Story should publish automatically.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  scheduledPublishAt: Date | null;

  @ApiProperty({
    description:
      'When a Chapter was last published or updated. Drives "recently updated" discovery.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  lastContentUpdateAt: Date | null;

  @ApiProperty({
    description:
      'Published Chapter count, maintained alongside the Chapter change that alters it.',
  })
  @Column({ type: 'integer', nullable: false, default: 0 })
  publishedChapterCount: number;

  @ApiProperty({ description: 'Thumbs Up count.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  upVoteCount: number;

  @ApiProperty({ description: 'Thumbs Down count.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  downVoteCount: number;

  @ApiProperty({
    description: 'When the owner accepted the content policy for this Story.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  contentPolicyAcceptedAt: Date | null;

  @ApiProperty({
    enum: StorytimeModerationStatus,
    description:
      'Whether an administrator has removed the Story. Independent of publication state.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeModerationStatus,
    enumName: 'storytime_moderation_status_enum',
    default: StorytimeModerationStatus.ACTIVE,
  })
  moderationStatus: StorytimeModerationStatus;

  @ApiProperty({ description: 'When the Story was removed.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  removedAt: Date | null;

  @ApiProperty({
    description: 'Administrator who removed the Story.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  removedByUserId: string | null;

  @ApiProperty({
    description: 'Category recorded for the removal.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  moderationReasonCode: string | null;

  @ApiProperty({
    description: 'Explanation shown to the creator verbatim.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  moderationMessage: string | null;

  @ApiProperty({ description: 'When the Story was restored.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  restoredAt: Date | null;

  @ApiProperty({
    description: 'Administrator who restored the Story.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  restoredByUserId: string | null;

  @ApiProperty({ description: 'User who created the Story.' })
  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  @ApiProperty({ description: 'User who last updated the Story.' })
  @Column({ type: 'uuid', nullable: false })
  updatedByUserId: string;

  @ApiProperty({
    description: 'User who soft-deleted the Story.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  deletedByUserId: string | null;

  @ApiProperty({
    description:
      'Optimistic-concurrency version. Reorder and edit requests supply it so a stale write is rejected rather than silently overwriting.',
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
   * Gets the banner image URL at desktop size.
   *
   * @returns The image URL, or null when the Story has no banner.
   */
  get bannerImageUrl(): string | null {
    return this.buildImageUrl(
      this.bannerImageId,
      STORYTIME_IMAGE_VARIANTS.BANNER_LARGE,
    );
  }

  /**
   * Gets the banner image URL at mobile size.
   *
   * @returns The image URL, or null when the Story has no banner.
   */
  get bannerImageMobileUrl(): string | null {
    return this.buildImageUrl(
      this.bannerImageId,
      STORYTIME_IMAGE_VARIANTS.BANNER_SMALL,
    );
  }

  /**
   * Gets the profile image URL.
   *
   * @returns The image URL, or null when the Story has no profile image.
   */
  get profileImageUrl(): string | null {
    return this.buildImageUrl(
      this.profileImageId,
      STORYTIME_IMAGE_VARIANTS.PROFILE_LARGE,
    );
  }

  /**
   * Gets the profile image URL at card size.
   *
   * @returns The image URL, or null when the Story has no profile image.
   */
  get profileImageThumbnailUrl(): string | null {
    return this.buildImageUrl(
      this.profileImageId,
      STORYTIME_IMAGE_VARIANTS.PROFILE_SMALL,
    );
  }

  /**
   * Builds a Cloudflare Images URL for a stored image ID.
   *
   * Returns null rather than a placeholder when there is no image: Storytime
   * artwork is optional throughout, and a missing image must render as nothing
   * at all rather than as an empty frame.
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
