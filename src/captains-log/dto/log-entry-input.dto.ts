import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginatedQueryDto } from 'src/shared/dto/paginated-query.dto';

import {
  LOG_BODY_MAX_LENGTH,
  LOG_HEADLINE_MAX_LENGTH,
  LOG_REMOVAL_REASON_MAX_LENGTH,
  LogEntryType,
} from '../captains-log.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** A new entry (sc-1450). */
export class CreateLogEntryDto {
  @ApiProperty({ description: 'Captain’s or Personal.', enum: LogEntryType })
  @IsEnum(LogEntryType)
  readonly type: LogEntryType;

  @ApiPropertyOptional({
    description:
      'The headline. Left out or blank, the entry is headed by its stardate.',
    maxLength: LOG_HEADLINE_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(LOG_HEADLINE_MAX_LENGTH)
  readonly headline?: string;

  @ApiProperty({
    description: 'The entry, in Markdown.',
    maxLength: LOG_BODY_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please write the entry' })
  @MaxLength(LOG_BODY_MAX_LENGTH)
  readonly body: string;
}

/** Changes to an entry; anything left out stays as it is. */
export class UpdateLogEntryDto {
  @ApiPropertyOptional({
    description: 'Captain’s or Personal.',
    enum: LogEntryType,
  })
  @IsOptional()
  @IsEnum(LogEntryType)
  readonly type?: LogEntryType;

  @ApiPropertyOptional({
    description:
      'The headline. Blank, the entry is headed by its stardate again.',
    maxLength: LOG_HEADLINE_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(LOG_HEADLINE_MAX_LENGTH)
  readonly headline?: string;

  @ApiPropertyOptional({
    description: 'The entry, in Markdown.',
    maxLength: LOG_BODY_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please write the entry' })
  @MaxLength(LOG_BODY_MAX_LENGTH)
  readonly body?: string;
}

/** Which of their own entries a member is listing. */
export class LogEntryQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({
    description: 'Only entries of this type.',
    enum: LogEntryType,
  })
  @IsOptional()
  @IsEnum(LogEntryType)
  readonly type?: LogEntryType;
}

/** Why a site admin is removing an entry. */
export class RemoveLogEntryDto {
  @ApiProperty({
    description: 'Why, for the author and the Security Log.',
    maxLength: LOG_REMOVAL_REASON_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please give a reason' })
  @MaxLength(LOG_REMOVAL_REASON_MAX_LENGTH)
  readonly reason: string;
}
