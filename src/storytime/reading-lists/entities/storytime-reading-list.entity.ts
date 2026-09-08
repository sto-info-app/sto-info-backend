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

/**
 * A reading list: things one member has gathered, in the order they mean them.
 *
 * A list is either private or public. Private is the default, because a list is
 * often a working note before it is a recommendation.
 */
@Entity({ name: 'storytime_reading_list' })
@Index(['ownerUserId', 'updatedAt'])
export class StorytimeReadingListEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Who keeps the list.' })
  @Column({ type: 'uuid', nullable: false })
  ownerUserId: string;

  @ApiProperty({ description: 'What the list is called.' })
  @Column({ type: 'varchar', length: 120, nullable: false })
  name: string;

  @ApiProperty({ description: 'The address of the list, within its owner.' })
  @Column({ type: 'varchar', length: 140, nullable: false })
  slug: string;

  @ApiProperty({ description: 'What the list is for.', nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  description: string | null;

  @ApiProperty({ description: 'Whether anybody may read it.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  isPublic: boolean;

  @ApiProperty({ description: 'How many things are on it.' })
  @Column({ type: 'int', nullable: false, default: 0 })
  itemCount: number;

  @ApiProperty({ description: 'When the list was made.' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: 'When it last changed.' })
  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
