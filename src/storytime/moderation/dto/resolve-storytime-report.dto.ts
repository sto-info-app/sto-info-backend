import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { ReportStatus } from '../../../moderation/enums/report-status.enum';

/** The statuses a report is still live in, where no resolution is due. */
const LIVE_REPORT_STATUSES: readonly ReportStatus[] = [
  ReportStatus.OPEN,
  ReportStatus.UNDER_REVIEW,
];

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Moves a report along the queue.
 *
 * The resolution is for the record rather than for the reporter: a reporter is
 * told their report was dealt with, never what was decided about somebody
 * else's account.
 */
export class ResolveStorytimeReportDto {
  @ApiProperty({
    enum: ReportStatus,
    description: 'The state to move the report into.',
  })
  @IsEnum(ReportStatus)
  readonly status: ReportStatus;

  @ApiPropertyOptional({
    description:
      'What was decided, for the record. Required to close a report, and ' +
      'kept in the site admin log (FC-039).',
    maxLength: 1000,
  })
  @ValidateIf(
    (dto: ResolveStorytimeReportDto) =>
      dto.resolution !== undefined ||
      !LIVE_REPORT_STATUSES.includes(dto.status),
  )
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  readonly resolution?: string;
}
