import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { ReportStatus } from '../../../moderation/enums/report-status.enum';

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
    description: 'What was decided, for the record.',
    maxLength: 1000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  readonly resolution?: string;
}
