import { ApiProperty } from '@nestjs/swagger';

import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The identifier and the two bookkeeping dates most tables carry: a UUID
 * primary key, and when the row was created and last updated, both as plain
 * `timestamp` columns.
 *
 * Abstract and without `@Entity`, so TypeORM maps its columns onto each table
 * that extends it rather than giving it one of its own. Subclasses supply the
 * `@Entity` and `@Index` metadata and every column of their own.
 */
export abstract class TimestampedRecordEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
