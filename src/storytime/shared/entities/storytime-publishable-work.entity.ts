import { ApiProperty } from '@nestjs/swagger';

import { Column } from 'typeorm';

import {
  ImageAltTextColumn,
  ImageReferenceColumn,
} from '../../../shared/entities/image-columns.decorator';
import { STORYTIME_IMAGE_VARIANTS } from '../../constants/storytime-image.constants';
import { StorytimeVisibility } from '../../enums/storytime-visibility.enum';
import { StorytimeWorkEntity } from './storytime-work.entity';

/**
 * A work published under its own page and address — a Story or an Arc —
 * with the owner, title, description, artwork and votes such a page shows.
 *
 * Its own publication state stays with each subclass, because a Story and an
 * Arc move through different ones.
 */
export abstract class StorytimePublishableWorkEntity extends StorytimeWorkEntity {
  @ApiProperty({ description: 'The user who owns it.' })
  @Column({ type: 'uuid', nullable: false })
  ownerUserId: string;

  @ApiProperty({ description: 'Its title.' })
  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @ApiProperty({ description: 'URL-friendly identifier, unique site-wide.' })
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

  @ImageReferenceColumn('Cloudflare Images ID for the wide banner.')
  bannerImageId: string | null;

  @ImageAltTextColumn('Alternative text for the banner.')
  bannerImageAlt: string | null;

  @ImageReferenceColumn('Cloudflare Images ID for the square profile image.')
  profileImageId: string | null;

  @ImageAltTextColumn('Alternative text for the profile image.')
  profileImageAlt: string | null;

  @ApiProperty({
    description: 'When it was first published.',
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

  /**
   * Gets the banner image URL at desktop size.
   *
   * @returns The image URL, or null when there is no banner.
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
   * @returns The image URL, or null when there is no profile image.
   */
  get profileImageUrl(): string | null {
    return this.buildImageUrl(
      this.profileImageId,
      STORYTIME_IMAGE_VARIANTS.PROFILE_LARGE,
    );
  }
}
