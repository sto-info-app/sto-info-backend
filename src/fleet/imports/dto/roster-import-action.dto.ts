import { ApiProperty } from '@nestjs/swagger';

import { RosterImportActionKind } from '../enums/roster-import-action-kind.enum';

/** What a correction changed, beyond which import and why. */
export class RosterImportActionDetailDto {
  @ApiProperty({
    description: 'For a row exclusion, the lines it named.',
    type: [Number],
    required: false,
  })
  lines?: number[];

  @ApiProperty({
    description: 'For a timezone correction, the zone before.',
    required: false,
    nullable: true,
  })
  fromTimezone?: string | null;

  @ApiProperty({
    description: 'For a timezone correction, the zone after.',
    required: false,
  })
  toTimezone?: string;

  @ApiProperty({
    description: 'For a timezone correction, the export instant before.',
    required: false,
    nullable: true,
  })
  fromExportedAt?: string | null;

  @ApiProperty({
    description: 'For a timezone correction, the export instant after.',
    required: false,
  })
  toExportedAt?: string;
}

/**
 * One thing an investigator did to an import, as its history reports it.
 *
 * Shown only to whoever investigates imports, with the investigator named by
 * their STO Info username.
 */
export class RosterImportActionDto {
  @ApiProperty({ description: 'The action.' })
  id: string;

  @ApiProperty({ enum: RosterImportActionKind, description: 'What was done.' })
  action: RosterImportActionKind;

  @ApiProperty({
    description: 'Who did it, by username, or null once that account is gone.',
    nullable: true,
  })
  actorName: string | null;

  @ApiProperty({ description: 'Why, in their own words.' })
  reason: string;

  @ApiProperty({
    description: 'The lines, or the zone and instant, it changed.',
    type: RosterImportActionDetailDto,
    nullable: true,
  })
  detail: RosterImportActionDetailDto | null;

  @ApiProperty({ description: 'When it was done.' })
  actedAt: Date;
}
