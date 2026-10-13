import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index } from 'typeorm';

import {
  ImageAltTextColumn,
  ImageReferenceColumn,
} from '../../../shared/entities/image-columns.decorator';
import { STORYTIME_IMAGE_VARIANTS } from '../../constants/storytime-image.constants';
import { StorytimeWorkEntity } from '../../shared/entities/storytime-work.entity';

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
 *
 * The moderation and audit columns are shared with the other works through
 * {@link StorytimeWorkEntity}.
 */
@Entity({ name: 'storytime_character' })
@Index(['storyId', 'displayOrder'])
export class StorytimeCharacterEntity extends StorytimeWorkEntity {
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

  @ImageReferenceColumn('Cloudflare Images ID for the portrait, 2:3.')
  portraitImageId: string | null;

  @ImageAltTextColumn('Alternative text for the portrait.')
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
    description: 'Category recorded for the removal.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  moderationReasonCode: string | null;

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
}
