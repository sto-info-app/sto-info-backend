import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index } from 'typeorm';

import { STORYTIME_IMAGE_VARIANTS } from '../../constants/storytime-image.constants';
import { STORYTIME_DEFAULT_LANGUAGE_CODE } from '../../constants/storytime-language.constants';
import { CompletionState } from '../../enums/completion-state.enum';
import { ContentRating } from '../../enums/content-rating.enum';
import { StoryStatus } from '../../enums/story-status.enum';
import { StorytimePublishableWorkEntity } from '../../shared/entities/storytime-publishable-work.entity';

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
 *
 * The owner, title, description, artwork, moderation and audit columns are
 * shared with an Arc through {@link StorytimePublishableWorkEntity}.
 */
@Entity({ name: 'storytime_story' })
@Index(['ownerUserId', 'ownerOrderIndex'])
export class StorytimeStoryEntity extends StorytimePublishableWorkEntity {
  @ApiProperty({ enum: StoryStatus, description: 'Publication state.' })
  @Column({
    type: 'enum',
    enum: StoryStatus,
    enumName: 'storytime_story_status_enum',
    default: StoryStatus.DRAFT,
  })
  status: StoryStatus;

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

  @ApiProperty({
    description: 'When the owner accepted the content policy for this Story.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  contentPolicyAcceptedAt: Date | null;

  @ApiProperty({
    description:
      'Which version of the Storytime publishing terms the owner accepted. ' +
      'Held beside the date because the Terms allow fresh acceptance to be ' +
      'required after a material change, which a date alone cannot express.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 20, nullable: true, default: null })
  contentPolicyVersion: string | null;

  @ApiProperty({
    description: 'Category recorded for the removal.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  moderationReasonCode: string | null;

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
}
