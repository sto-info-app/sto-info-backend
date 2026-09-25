import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

/**
 * The span a report covers, and the export its detail is drawn at (FC-020).
 *
 * An export is in the span when it was taken within it, and an interval when
 * its later export was. Every effective export when neither end is given.
 */
export class FleetReportQueryDto {
  @ApiPropertyOptional({
    description: 'The earliest instant covered, ISO 8601.',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  readonly from?: string;

  @ApiPropertyOptional({
    description: 'The latest instant covered, ISO 8601.',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  readonly to?: string;

  @ApiPropertyOptional({
    description:
      'For a full view, the effective export whose detail is shown — the ' +
      'members at it, or the interval ending at it. The latest in the span ' +
      'when omitted. Ignored for an aggregate view, which has no detail.',
  })
  @IsOptional()
  @IsUUID()
  readonly at?: string;
}
