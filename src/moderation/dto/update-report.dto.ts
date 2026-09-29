import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { ADMIN_REASON_MAX } from 'src/shared/dto/admin-reason.dto';

import { ReportStatus } from '../enums/report-status.enum';

/** The states a report is still live in, where no reason is due. */
export const LIVE_REPORT_STATUSES: readonly ReportStatus[] = [
  ReportStatus.OPEN,
  ReportStatus.UNDER_REVIEW,
];

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * An administrator's decision on a report.
 */
export class UpdateReportDto {
  @ApiProperty({
    description: 'The state to move the report into.',
    enum: ReportStatus,
    example: ReportStatus.DISMISSED,
  })
  @IsEnum(ReportStatus)
  readonly status: ReportStatus;

  @ApiPropertyOptional({
    description:
      'Internal notes recording what was found or done. Never shown to ' +
      'either member.',
    maxLength: 2000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  readonly moderatorNotes?: string;

  @ApiPropertyOptional({
    description:
      'Why. Required to close a report, and kept in the site admin log ' +
      '(FC-039). Claiming one needs none.',
    maxLength: ADMIN_REASON_MAX,
  })
  @ValidateIf(
    (dto: UpdateReportDto) =>
      dto.reason !== undefined || !LIVE_REPORT_STATUSES.includes(dto.status),
  )
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ADMIN_REASON_MAX)
  readonly reason?: string;
}
