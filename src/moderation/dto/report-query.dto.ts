import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { SearchPaginatedQueryDto } from '../../shared/dto/paginated-query.dto';
import { ReportReason } from '../enums/report-reason.enum';
import { ReportStatus } from '../enums/report-status.enum';

/**
 * Query parameters accepted by the admin report queue.
 *
 * Every accepted parameter must be declared here — the global `ValidationPipe`
 * runs with `forbidNonWhitelisted: true`, so undeclared params are rejected.
 */
export class ReportQueryDto extends SearchPaginatedQueryDto {
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
}
