import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Appeals against a removal.
 */
export class CreateAppealDto {
  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of content was removed.',
  })
  @IsEnum(StorytimeTargetType)
  readonly targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The removed content.' })
  @IsUUID()
  readonly targetId: string;

  @ApiProperty({
    description: 'What the creator has to say about the removal.',
    maxLength: 2000,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  readonly body: string;
}
