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

import { StorytimeReportReason } from '../../enums/storytime-report-reason.enum';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Removes or restores a piece of content.
 *
 * The message is required on a removal and shown to the creator verbatim.
 * Nobody can fix, or meaningfully appeal, a removal they have not been given a
 * reason for.
 */
export class ModerateContentDto {
  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of content is being acted on.',
  })
  @IsEnum(StorytimeTargetType)
  readonly targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The content being acted on.' })
  @IsUUID()
  readonly targetId: string;

  @ApiPropertyOptional({
    enum: StorytimeReportReason,
    description: 'The policy category cited.',
  })
  @IsOptional()
  @IsEnum(StorytimeReportReason)
  readonly reasonCode: StorytimeReportReason | null = null;

  @ApiProperty({
    description: 'What the creator is told, shown to them word for word.',
    maxLength: 1000,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  readonly message: string;
}
