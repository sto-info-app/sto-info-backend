import { ApiProperty } from '@nestjs/swagger';

import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';

/** Shared create properties for a definition. */
export class CreateCustomTrackingDefinitionDto {
  @ApiProperty({
    description: 'The label shown for this definition.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH,
    example: 'Ship collection',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH)
  name: string;

  @ApiProperty({
    description: 'Help text describing this definition.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH)
  description: string | null = null;

  @ApiProperty({
    description:
      'Whether this definition may be shown publicly. Off unless asked for.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  publiclyVisible = false;
}

/** Shared update properties for a definition. */
export class UpdateCustomTrackingDefinitionDto {
  @ApiProperty({
    description: 'The label shown for this definition.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH,
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH)
  name?: string;

  @ApiProperty({
    description: 'Help text describing this definition.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiProperty({
    description: 'Whether this definition may be shown publicly.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  publiclyVisible?: boolean;
}
