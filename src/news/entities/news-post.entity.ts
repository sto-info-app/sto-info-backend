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
import { NewsCategory } from '../enums/news-category.enum';
import { NewsStatus } from '../enums/news-status.enum';

/**
 * A public news post / release note authored by a site administrator.
 */
@Entity({ name: 'news_post' })
export class NewsPostEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'URL-friendly unique slug used to address the post.',
    example: 'v1-2-0-release-notes',
  })
  @Index({ unique: true })
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

  @ApiProperty({ enum: NewsCategory, description: 'Category grouping.' })
  @Column({
    type: 'enum',
    enum: NewsCategory,
    enumName: 'news_category_enum',
    default: NewsCategory.GENERAL,
  })
  category: NewsCategory;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
