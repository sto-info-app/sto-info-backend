import { ApiProperty } from '@nestjs/swagger';

import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * One Fleet holding in the reference catalogue, such as the Fleet Starbase
 * (FC-023).
 *
 * Seeded by migration from the STO Wiki, and changed only by a reviewed
 * migration: each holding keeps the page it was read from, the day that page
 * was last edited, and the catalogue version that last changed it.
 */
@Entity({ name: 'fleet_holding_type' })
export class FleetHoldingTypeEntity {
  @ApiProperty({ description: 'Stable code, such as STARBASE.' })
  @PrimaryColumn({ type: 'varchar', length: 40 })
  code: string;

  @ApiProperty({ description: 'Its name in game.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @ApiProperty({ description: 'Where it comes in the catalogue.' })
  @Column({ type: 'smallint', nullable: false })
  position: number;

  @ApiProperty({ description: 'The wiki page it was read from.' })
  @Column({ type: 'varchar', length: 300, nullable: false })
  sourceUrl: string;

  @ApiProperty({
    description: 'The day that page was last edited, as YYYY-MM-DD.',
  })
  @Column({ type: 'date', nullable: false })
  sourceEditedOn: string;

  @ApiProperty({ description: 'The catalogue version that last changed it.' })
  @Column({ type: 'smallint', nullable: false })
  catalogueVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
