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
import { SpotlightEntityType } from '../../enums/spotlight-entity-type.enum';

/**
 * A Spotlight entry: an editorial selection highlighting a Story or an Arc.
 *
 * The entry holds only the editor's own words. Everything about the featured
 * work — its title, its artwork, whether it is still readable at all — is read
 * through the target when somebody looks, so a Story that is unpublished or
 * removed drops out of the Spotlight without anybody having to remember to
 * rewrite it.
 */
@Entity({ name: 'storytime_spotlight' })
@Index(['isPublished', 'startsAt', 'displayPriority'])
export class StorytimeSpotlightEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'URL-friendly identifier, unique site-wide.' })
  @Column({ type: 'varchar', length: 220, nullable: false })
  slug: string;

  @ApiProperty({
    enum: SpotlightEntityType,
    description: 'What kind of work is featured.',
  })
  @Column({
    type: 'enum',
    enum: SpotlightEntityType,
    enumName: 'storytime_spotlight_entity_type_enum',
  })
  entityType: SpotlightEntityType;

  @ApiProperty({
    description: 'The featured Story, when one is featured.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  storyId: string | null;

  @ApiProperty({
    description: 'The featured Arc, when one is featured.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  arcId: string | null;

  @ApiProperty({ description: 'The editorial headline.' })
  @Column({ type: 'varchar', length: 200, nullable: false })
  headline: string;

  @ApiProperty({ description: 'The editorial summary shown with it.' })
  @Column({ type: 'text', nullable: false })
  summary: string;

  @ApiProperty({
    description: 'Why this work was chosen, shown to readers.',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true, default: null })
  selectionReason: string | null;

  @ApiProperty({
    description:
      'Cloudflare Images ID used instead of the work’s own banner, if any.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 160, nullable: true, default: null })
  overrideImageId: string | null;

  @ApiProperty({
    description: 'Alternative text for the override image.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  overrideImageAlt: string | null;

  @ApiProperty({
    description: 'Higher entries are shown first while several overlap.',
  })
  @Column({ type: 'integer', nullable: false, default: 0 })
  displayPriority: number;

  @ApiProperty({ description: 'When the entry starts showing.' })
  @Column({ type: 'timestamp', nullable: false })
  startsAt: Date;

  @ApiProperty({
    description: 'When it stops showing. Open-ended when absent.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  endsAt: Date | null;

  @ApiProperty({
    description:
      'Whether the entry may show at all. An unpublished entry never appears, whatever its dates say.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  isPublished: boolean;

  @ApiProperty({ description: 'Editor who created the entry.' })
  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  @ApiProperty({ description: 'Editor who last changed it.' })
  @Column({ type: 'uuid', nullable: false })
  updatedByUserId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;

  /**
   * Gets the override image at desktop size.
   *
   * @returns The image URL, or null when no override was set.
   */
  get overrideImageUrl(): string | null {
    return this.buildImageUrl(STORYTIME_IMAGE_VARIANTS.BANNER_LARGE);
  }

  /**
   * Gets the override image at mobile size.
   *
   * @returns The image URL, or null when no override was set.
   */
  get overrideImageMobileUrl(): string | null {
    return this.buildImageUrl(STORYTIME_IMAGE_VARIANTS.BANNER_SMALL);
  }

  /**
   * Builds a Cloudflare Images URL for the override image.
   *
   * @param variant - The Cloudflare variant to request.
   * @returns The URL, or null when there is no override image.
   */
  private buildImageUrl(variant: string): string | null {
    return this.overrideImageId
      ? buildCloudflareImageUrl(this.overrideImageId, variant)
      : null;
  }
}
