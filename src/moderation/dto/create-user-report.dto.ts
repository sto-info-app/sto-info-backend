import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { ReportReason } from '../enums/report-reason.enum';

/**
 * Reports a member by profile username.
 *
 * Members are addressed by username here for the same reason as everywhere else
 * in the community section: no user ID crosses the public boundary.
 */
export class CreateUserReportDto {
  @ApiProperty({
    description: 'The profile username of the member being reported.',
    example: 'captain.picard',
    maxLength: 50,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  readonly username: string;

  @ApiProperty({
    description: 'The category that best describes the conduct.',
    enum: ReportReason,
    example: ReportReason.HARASSMENT,
  })
  @IsEnum(ReportReason)
  readonly reason: ReportReason;

  @ApiPropertyOptional({
    description: 'What happened, in the reporter’s own words.',
    maxLength: 1000,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(1000)
  readonly details?: string;

  @ApiPropertyOptional({
    description:
      'The Captain’s entry on their profile the report is about (sc-1450).',
  })
  @IsOptional()
  @IsUUID('4')
  readonly logEntryId?: string;
}
