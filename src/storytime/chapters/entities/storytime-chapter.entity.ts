import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index } from 'typeorm';

import {
  ImageAltTextColumn,
  ImageReferenceColumn,
} from '../../../shared/entities/image-columns.decorator';
import { STORYTIME_IMAGE_VARIANTS } from '../../constants/storytime-image.constants';
import { ChapterStatus } from '../../enums/chapter-status.enum';
import { StorytimeWorkEntity } from '../../shared/entities/storytime-work.entity';

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
 *
 * The moderation and audit columns are shared with the other works through
 * {@link StorytimeWorkEntity}.
 */
@Entity({ name: 'storytime_chapter' })
@Index(['storyId', 'orderIndex'])
export class StorytimeChapterEntity extends StorytimeWorkEntity {
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

  @ImageReferenceColumn('Cloudflare Images ID for the cover.')
  coverImageId: string | null;

  @ImageAltTextColumn('Alternative text for the cover.')
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
    description: 'Category recorded for the removal.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  moderationReasonCode: string | null;

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
}
