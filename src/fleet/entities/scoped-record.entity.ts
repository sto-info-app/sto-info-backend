import { ApiProperty } from '@nestjs/swagger';

import { Column, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A row filed under one scope: a Community, or a Fleet or an Armada within it.
 *
 * The scope is expressed as **typed columns rather than an object ID and a
 * type string**, as plan section 4.1 requires. `communityId` is always
 * present; `fleetId` and `armadaId` are nullable and at most one is set,
 * which each table enforces with a check constraint. A row with neither set
 * belongs to the Community itself.
 *
 * Abstract and without `@Entity`. Relations are left to the subclasses,
 * because not every table filed this way declares a foreign key to each of
 * the three.
 */
export abstract class ScopedRecordEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Community the scope belongs to.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({
    description: 'The Fleet, when the scope is a Fleet.',
    type: String,
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  fleetId: string | null;

  @ApiProperty({
    description: 'The Armada, when the scope is an Armada.',
    type: String,
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  armadaId: string | null;
}
