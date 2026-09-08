import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Columns shared by sections, tabs and fields; inherited without a new table. */
export abstract class CustomTrackingDefinitionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The label shown for this definition.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @ApiProperty({
    description:
      'The name lower-cased, so sibling names are unique without regard to case.',
  })
  @Column({ type: 'varchar', length: 100, nullable: false })
  nameNormalized: string;

  @ApiProperty({
    description: 'Help text describing this definition.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  description: string | null;

  @ApiProperty({ description: 'Position among its siblings.' })
  @Column({ type: 'integer', nullable: false })
  orderIndex: number;

  @ApiProperty({
    description:
      'Whether this definition may be shown publicly. Private ancestors hide it regardless.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  publiclyVisible: boolean;

  @ApiProperty({
    description:
      'When an administrator suppressed this definition from public view.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  suppressedAt: Date | null;

  @ApiProperty({
    description: 'The administrator who suppressed it.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  suppressedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
