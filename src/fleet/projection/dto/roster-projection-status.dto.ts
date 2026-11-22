import { ApiProperty } from '@nestjs/swagger';

import { RosterProjectionInputOutcome } from '../enums/roster-projection-input-outcome.enum';

/** One import a revision considered, and what it made of it. */
export class RosterProjectionInputDto {
  @ApiProperty({ description: 'The import.' })
  importId: string;

  @ApiProperty({ description: 'Its filename, as uploaded.' })
  originalFilename: string;

  @ApiProperty({ description: 'The instant its export claims.' })
  exportedAt: Date;

  @ApiProperty({
    enum: RosterProjectionInputOutcome,
    description: 'Whether it was read, and why not when it was not.',
  })
  outcome: RosterProjectionInputOutcome;

  @ApiProperty({ description: 'Whether it was marked partial.' })
  partial: boolean;

  @ApiProperty({ description: 'How many of its rows were excluded.' })
  excludedRows: number;
}

/**
 * Where a Fleet's roster history stands (FC-019).
 *
 * The published revision, whether a newer one has been asked for, and every
 * import it considered — so a reader can see not only what the history was
 * built from but what it left out and why.
 */
export class RosterProjectionStatusDto {
  @ApiProperty({
    description: 'The published revision, or 0 before the first is built.',
  })
  revision: number;

  @ApiProperty({
    description: 'When it was published, or null before the first.',
    nullable: true,
  })
  publishedAt: Date | null;

  @ApiProperty({
    description:
      'Whether a change has been made since it was built. The published ' +
      'revision is still what is served until the next one is.',
  })
  stale: boolean;

  @ApiProperty({
    description: 'Its latest effective export, or null when it has none.',
    nullable: true,
  })
  latestImportId: string | null;

  @ApiProperty({
    description:
      'Every import it considered, in export order: each one in force or ' +
      'held when it was built.',
    type: [RosterProjectionInputDto],
  })
  inputs: RosterProjectionInputDto[];
}
