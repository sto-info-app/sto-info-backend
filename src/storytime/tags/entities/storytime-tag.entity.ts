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

import { StorytimeTagCategory } from '../../enums/storytime-tag-category.enum';

/**
 * One tag in the Storytime vocabulary.
 *
 * Administrator-managed: primary classification only works if everybody uses
 * the same words, and a vocabulary anybody can extend stops being one. Creators
 * choose from this list rather than inventing terms, which is what makes a tag
 * filter worth offering.
 */
@Entity({ name: 'storytime_tag' })
@Index(['category', 'displayOrder'])
export class StorytimeTagEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'URL-friendly identifier, unique site-wide.' })
  @Column({ type: 'varchar', length: 120, nullable: false })
  slug: string;

  @ApiProperty({ description: 'What the tag is called.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @ApiProperty({
    description: 'What it means, for the administrator choosing it.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  description: string | null;

  @ApiProperty({
    enum: StorytimeTagCategory,
    description: 'Which shelf the tag belongs on.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeTagCategory,
    enumName: 'storytime_tag_category_enum',
  })
  category: StorytimeTagCategory;

  @ApiProperty({
    description:
      'Whether an administrator owns this tag. Always true today; creator-supplied secondary tags would not be.',
  })
  @Column({ type: 'boolean', nullable: false, default: true })
  isAdminManaged: boolean;

  @ApiProperty({ description: 'Where it sits within its category.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  displayOrder: number;

  @ApiProperty({ description: 'Administrator who added it.' })
  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  @ApiProperty({ description: 'Administrator who last changed it.' })
  @Column({ type: 'uuid', nullable: false })
  updatedByUserId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
