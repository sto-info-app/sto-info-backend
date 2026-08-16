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
import { StorytimeModerationStatus } from '../../enums/storytime-moderation-status.enum';

/**
 * A Character: somebody who appears in a Story.
 *
 * Characters belong to one Story rather than to the site. Two creators writing
 * about the same canon captain each own their own portrayal, and neither can
 * edit the other's — which also means a Character's slug need only be unique
 * within its Story.
 *
 * There is no `languageCode`: a Character is described in whatever language
 * the Story is written in, and a Story that changes language changes its cast
 * with it.
 *
 * There is no publication state either. A Character is visible exactly when
 * its Story is, because a cast list that could be published separately from
 * the Story it belongs to would only ever be half a cast list.
 */
@Entity({ name: 'storytime_character' })
@Index(['storyId', 'displayOrder'])
export class StorytimeCharacterEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Story this Character belongs to.' })
  @Column({ type: 'uuid', nullable: false })
  storyId: string;

  @ApiProperty({ description: 'The name readers know them by.' })
  @Column({ type: 'varchar', length: 200, nullable: false })
  name: string;

  @ApiProperty({
    description: 'URL-friendly identifier, unique within the Story.',
  })
  @Column({ type: 'varchar', length: 220, nullable: false })
  slug: string;

  @ApiProperty({
    description: 'One-line description shown on a cast card.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  shortBio: string | null;

  @ApiProperty({
    description:
      'The full biography, authored as Markdown. The source of truth.',
  })
  @Column({ type: 'text', nullable: false, default: '' })
  biographySource: string;

  @ApiProperty({
    description:
      'Server-rendered, sanitised HTML. A cache of biographySource, regenerated on every change.',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true, default: null })
  biographyHtml: string | null;

  @ApiProperty({
    description:
      'The renderer version that produced biographyHtml, so stored HTML can be regenerated when the renderer changes.',
  })
  @Column({ type: 'integer', nullable: false, default: 1 })
  biographySchemaVersion: number;

  @ApiProperty({
    description: 'Cloudflare Images ID for the portrait, 2:3.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  portraitImageId: string | null;

  @ApiProperty({
    description: 'Alternative text for the portrait.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  portraitImageAlt: string | null;

  @ApiProperty({ description: 'Species, as free text.', nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  species: string | null;

  @ApiProperty({ description: 'Faction, as free text.', nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  faction: string | null;

  @ApiProperty({ description: 'Rank, as free text.', nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  rank: string | null;

  @ApiProperty({ description: 'Occupation or role.', nullable: true })
  @Column({ type: 'varchar', length: 150, nullable: true, default: null })
  occupation: string | null;

  @ApiProperty({ description: 'Affiliation or allegiance.', nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  affiliation: string | null;

  @ApiProperty({ description: 'Ship or posting.', nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  shipAssignment: string | null;

  @ApiProperty({
    description: 'Short descriptive traits, as a list of plain strings.',
    nullable: true,
    type: [String],
  })
  @Column({ type: 'jsonb', nullable: true, default: null })
  traits: string[] | null;

  @ApiProperty({
    description: 'Whether this is one of the Story’s main Characters.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  isPrimary: boolean;

  @ApiProperty({ description: 'Position within the Story’s cast list.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  displayOrder: number;

  @ApiProperty({
    enum: StorytimeModerationStatus,
    description: 'Whether an administrator has removed the Character.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeModerationStatus,
    enumName: 'storytime_moderation_status_enum',
    default: StorytimeModerationStatus.ACTIVE,
  })
  moderationStatus: StorytimeModerationStatus;

  @ApiProperty({
    description: 'When the Character was removed.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  removedAt: Date | null;

  @ApiProperty({
    description: 'Administrator who removed the Character.',
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
    description: 'When the Character was restored.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  restoredAt: Date | null;

  @ApiProperty({
    description: 'Administrator who restored the Character.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  restoredByUserId: string | null;

  @ApiProperty({ description: 'User who created the Character.' })
  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  @ApiProperty({ description: 'User who last updated the Character.' })
  @Column({ type: 'uuid', nullable: false })
  updatedByUserId: string;

  @ApiProperty({
    description: 'User who soft-deleted the Character.',
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
   * Gets the portrait URL at full size.
   *
   * @returns The image URL, or null when the Character has no portrait.
   */
  get portraitImageUrl(): string | null {
    return this.buildImageUrl(
      this.portraitImageId,
      STORYTIME_IMAGE_VARIANTS.PORTRAIT_LARGE,
    );
  }

  /**
   * Gets the portrait URL at cast-list size.
   *
   * @returns The image URL, or null when the Character has no portrait.
   */
  get portraitImageThumbnailUrl(): string | null {
    return this.buildImageUrl(
      this.portraitImageId,
      STORYTIME_IMAGE_VARIANTS.PORTRAIT_SMALL,
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
