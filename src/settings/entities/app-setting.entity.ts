import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A single operational setting that can be changed without a deployment.
 *
 * Deliberately narrow in purpose. Configuration that only changes between
 * environments belongs in environment variables; this table is for the few
 * switches an administrator must be able to throw while the site is running,
 * such as taking a feature offline when something goes wrong.
 *
 * Values are stored as text and interpreted by the reader, so a new setting
 * needs no schema change.
 */
@Entity({ name: 'app_setting' })
export class AppSettingEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'Stable setting key.',
    example: 'STORYTIME_ENABLED',
  })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80, nullable: false })
  key: string;

  @ApiProperty({
    description: 'The setting value, interpreted by whoever reads it.',
  })
  @Column({ type: 'varchar', length: 500, nullable: false })
  value: string;

  @ApiProperty({
    description: 'What the setting controls.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  description: string | null;

  @ApiProperty({
    description: 'Administrator who last changed the value.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  updatedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
