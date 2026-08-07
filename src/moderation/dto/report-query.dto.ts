import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReportReason } from '../enums/report-reason.enum';
import { ReportStatus } from '../enums/report-status.enum';

/**
 * Query parameters accepted by the admin report queue.
 *
 * Every accepted parameter must be declared here — the global `ValidationPipe`
 * runs with `forbidNonWhitelisted: true`, so undeclared params are rejected.
 */
export class ReportQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by queue state. Omit to list every report.',
    enum: ReportStatus,
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  readonly status?: ReportStatus;

  @ApiPropertyOptional({
    description: 'Filter by the category the reporter chose.',
    enum: ReportReason,
  })
  @IsOptional()
  @IsEnum(ReportReason)
  readonly reason?: ReportReason;

  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match against either member’s username.',
    example: 'picard',
    maxLength: 50,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(50)
  readonly search?: string;

  @ApiPropertyOptional({
    description: 'Page number (1-based).',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({
    description: 'Items per page.',
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  readonly pageSize?: number;
}
