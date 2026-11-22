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

import { AuditIdentifiersOnly } from 'src/audit/audit-redaction';
import { FleetAudience } from 'src/fleet/enums/fleet-audience.enum';

import { NewsCategory } from '../enums/news-category.enum';
import { NewsStatus } from '../enums/news-status.enum';

/**
 * A news post: the site's own, written by a site administrator, or a
 * Community's, a Fleet's or an Armada's (FC-027).
 *
 * The site's posts name no scope, have a category and no audience, and are
 * public once published. A scoped post names its Community and, for a Fleet or
 * an Armada, that too; it has an audience and no category, and may carry a
 * cover image. `CHK_news_post_scope` holds both shapes, and every query for
 * the site's news asks for `communityId IS NULL` explicitly.
 */
@AuditIdentifiersOnly()
@Entity({ name: 'news_post' })
export class NewsPostEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description:
      'URL-friendly slug used to address the post, unique among the site’s posts or within its scope.',
    example: 'v1-2-0-release-notes',
  })
  @Column({ type: 'varchar', length: 280, nullable: false })
  slug: string;

  @ApiProperty({ description: 'Post title.' })
  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @ApiProperty({
    description: 'Short plain-text summary used in listings.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  summary: string | null;

  @ApiProperty({ description: 'Post body, authored as Markdown.' })
  @Column({ type: 'text', nullable: false })
  body: string;

  @ApiProperty({
    enum: NewsCategory,
    description: 'Category grouping, for the site’s posts only.',
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: NewsCategory,
    enumName: 'news_category_enum',
    nullable: true,
    default: NewsCategory.GENERAL,
  })
  category: NewsCategory | null;

  @ApiProperty({ enum: NewsStatus, description: 'Publication state.' })
  @Index()
  @Column({
    type: 'enum',
    enum: NewsStatus,
    enumName: 'news_status_enum',
    default: NewsStatus.DRAFT,
  })
  status: NewsStatus;

  @ApiProperty({
    description: 'When the post was published (null while a draft).',
    nullable: true,
  })
  @Index()
  @Column({ type: 'timestamp', nullable: true, default: null })
  publishedAt: Date | null;

  @ApiProperty({
    description: 'User ID of the administrator who authored the post.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  authorId: string | null;

  @ApiProperty({
    description: 'The Community a scoped post belongs to; null for the site’s.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  communityId: string | null;

  @ApiProperty({
    description: 'The Fleet a Fleet’s post belongs to.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  fleetId: string | null;

  @ApiProperty({
    description: 'The Armada an Armada’s post belongs to.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  armadaId: string | null;

  @ApiProperty({
    enum: FleetAudience,
    description: 'Who may read a scoped post; null for the site’s.',
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: FleetAudience,
    enumName: 'fleet_audience_enum',
    nullable: true,
    default: null,
  })
  audience: FleetAudience | null;

  @ApiProperty({
    description: 'Delivery reference of a scoped post’s cover image.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  coverImageId: string | null;

  @ApiProperty({
    description: 'What the cover image shows.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  coverImageAlt: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
