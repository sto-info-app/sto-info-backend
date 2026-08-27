import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ReportStatus } from '../../../moderation/enums/report-status.enum';
import { StorytimeReportReason } from '../../enums/storytime-report-reason.enum';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Reports a piece of Storytime content.
 *
 * The description is optional because the categories cover most of what people
 * report, and demanding an explanation from somebody who has just read
 * something upsetting is a poor way to ask.
 */
export class CreateStorytimeReportDto {
  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of content is being reported.',
  })
  @IsEnum(StorytimeTargetType)
  readonly targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The content being reported.' })
  @IsUUID()
  readonly targetId: string;

  @ApiProperty({
    enum: StorytimeReportReason,
    description: 'The policy category that fits best.',
  })
  @IsEnum(StorytimeReportReason)
  readonly reasonCode: StorytimeReportReason;

  @ApiPropertyOptional({
    description: 'Anything the reporter wants to add.',
    maxLength: 2000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  readonly description?: string;
}

/**
 * Filters the moderation queue.
 */
export class StorytimeReportQueryDto {
  @ApiPropertyOptional({
    enum: ReportStatus,
    description: 'Show only reports in this state.',
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  readonly status?: ReportStatus;
}
