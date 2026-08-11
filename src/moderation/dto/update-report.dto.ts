import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportStatus } from '../enums/report-status.enum';

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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(2000)
  readonly moderatorNotes?: string;
}
