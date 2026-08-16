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
import { ChapterStatus } from '../../enums/chapter-status.enum';
import { StorytimeModerationStatus } from '../../enums/storytime-moderation-status.enum';

/**
 * A Chapter: one ordered instalment within a Story.
 *
 * A Chapter may reach {@link ChapterStatus.PUBLISHED} while its Story is still
 * a draft. It only becomes publicly reachable once the Story is itself
 * publicly readable, which is what lets a creator stage a complete Story and
 * then release the whole thing with a single action.
 *
 * `languageCode` is nullable and means "the same as the Story". Storing the
 * Story's language on every Chapter would go stale the moment the Story's
 * changed, so the Chapter records only a deliberate departure — a translated
 * instalment, or one written in Klingon.
 */
@Entity({ name: 'storytime_chapter' })
@Index(['storyId', 'orderIndex'])
export class StorytimeChapterEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Story this Chapter belongs to.' })
  @Column({ type: 'uuid', nullable: false })
  storyId: string;

  @ApiProperty({ description: 'Chapter title.' })
  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @ApiProperty({
    description: 'URL-friendly identifier, unique within the Story.',
  })
  @Column({ type: 'varchar', length: 220, nullable: false })
  slug: string;

  @ApiProperty({
    description: 'Short summary shown in the Chapter list.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  synopsis: string | null;

  @ApiProperty({
    description: 'The Chapter body, authored as Markdown. The source of truth.',
  })
  @Column({ type: 'text', nullable: false, default: '' })
  contentSource: string;

  @ApiProperty({
    description:
      'Server-rendered, sanitised HTML. A cache of contentSource, regenerated on every content change.',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true, default: null })
  contentHtml: string | null;

  @ApiProperty({
    description:
      'The renderer version that produced contentHtml, so stored HTML can be regenerated when the renderer changes.',
  })
  @Column({ type: 'integer', nullable: false, default: 1 })
  contentSchemaVersion: number;

  @ApiProperty({ enum: ChapterStatus, description: 'Publication state.' })
  @Column({
    type: 'enum',
    enum: ChapterStatus,
    enumName: 'storytime_chapter_status_enum',
    default: ChapterStatus.DRAFT,
  })
  status: ChapterStatus;

  @ApiProperty({
    description:
      'BCP 47 language, when this Chapter departs from the Story language. Null means it matches the Story.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 10, nullable: true, default: null })
  languageCode: string | null;

  @ApiProperty({ description: 'Position within the Story.' })
  @Column({ type: 'integer', nullable: false })
  orderIndex: number;

  @ApiProperty({
    description: 'Cloudflare Images ID for the cover.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  coverImageId: string | null;

  @ApiProperty({
    description: 'Alternative text for the cover.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  coverImageAlt: string | null;

  @ApiProperty({ description: 'Words in the Chapter body.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  wordCount: number;

  @ApiProperty({
    description: 'Estimated reading time in whole minutes.',
    nullable: true,
  })
  @Column({ type: 'integer', nullable: true, default: null })
  estimatedReadingMinutes: number | null;

  @ApiProperty({
    description: 'When the Chapter was first published.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  publishedAt: Date | null;

  @ApiProperty({
    description: 'When the Chapter should publish automatically.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  scheduledPublishAt: Date | null;

  @ApiProperty({ description: 'Thumbs Up count.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  upVoteCount: number;

  @ApiProperty({ description: 'Thumbs Down count.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  downVoteCount: number;

  @ApiProperty({
    enum: StorytimeModerationStatus,
    description:
      'Whether an administrator has removed the Chapter. Independent of publication state.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeModerationStatus,
    enumName: 'storytime_moderation_status_enum',
    default: StorytimeModerationStatus.ACTIVE,
  })
  moderationStatus: StorytimeModerationStatus;

  @ApiProperty({ description: 'When the Chapter was removed.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  removedAt: Date | null;

  @ApiProperty({
    description: 'Administrator who removed the Chapter.',
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

  @ApiProperty({
    description: 'When the Chapter was restored.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  restoredAt: Date | null;

  @ApiProperty({
    description: 'Administrator who restored the Chapter.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  restoredByUserId: string | null;

  @ApiProperty({ description: 'User who created the Chapter.' })
  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  @ApiProperty({ description: 'User who last updated the Chapter.' })
  @Column({ type: 'uuid', nullable: false })
  updatedByUserId: string;

  @ApiProperty({
    description: 'User who soft-deleted the Chapter.',
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
   * Gets the cover image URL at full size.
   *
   * @returns The image URL, or null when the Chapter has no cover.
   */
  get coverImageUrl(): string | null {
    return this.buildImageUrl(
      this.coverImageId,
      STORYTIME_IMAGE_VARIANTS.COVER_LARGE,
    );
  }

  /**
   * Gets the cover image URL at card size.
   *
   * @returns The image URL, or null when the Chapter has no cover.
   */
  get coverImageThumbnailUrl(): string | null {
    return this.buildImageUrl(
      this.coverImageId,
      STORYTIME_IMAGE_VARIANTS.COVER_SMALL,
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
