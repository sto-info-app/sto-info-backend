import { ApiProperty } from '@nestjs/swagger';

import { Column, Index } from 'typeorm';

import { TimestampedRecordEntity } from '../../shared/entities/timestamped-record.entity';

/**
 * What a permission and a permission group both are: an entry in the
 * access-control catalogue, found by a stable code and shown by a name.
 *
 * The code is what guards, seeds and the frontend refer to, so it never
 * changes once issued; the name and description are for the people reading
 * the administration screens.
 */
export abstract class PermissionCatalogueEntryEntity extends TimestampedRecordEntity {
  @ApiProperty({
    description: 'Stable code referenced by guards, seeds and the frontend.',
    example: 'storytime.story.create',
  })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100, nullable: false })
  code: string;

  @ApiProperty({ description: 'Human-readable name.' })
  @Column({ type: 'varchar', length: 150, nullable: false })
  name: string;

  @ApiProperty({
    description: 'What it is for.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  description: string | null;
}
