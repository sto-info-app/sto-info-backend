import { ApiProperty } from '@nestjs/swagger';

import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';

/**
 * Creating an option on a choice or tags Field.
 */
export class CreateCustomTrackingOptionDto {
  @ApiProperty({
    description: 'The wording offered to whoever is answering.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH,
    example: 'Fleet ship',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH)
  label: string;

  @ApiProperty({
    description:
      'Whether an editor with no value starts with this option chosen.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault = false;
}

/**
 * Changing an option. Absent means leave alone, not clear.
 */
export class UpdateCustomTrackingOptionDto {
  @ApiProperty({
    description: 'The wording offered to whoever is answering.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH,
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH)
  label?: string;

  @ApiProperty({
    description: 'Whether an editor with no value starts with it chosen.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * An option as its owner sees it.
 *
 * Withdrawn options appear too, because a value that already chose one has to
 * go on reading correctly and its editor has to be able to say what it was.
 */
export class CustomTrackingOptionDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Field offering it.' })
  fieldId: string;

  @ApiProperty({ description: 'The wording offered.' })
  label: string;

  @ApiProperty({ description: 'Position among its siblings.' })
  orderIndex: number;

  @ApiProperty({ description: 'Whether a new editor starts with it chosen.' })
  isDefault: boolean;

  @ApiProperty({
    description:
      'Whether it has been withdrawn. A withdrawn option still displays where it was already chosen, but cannot be chosen again.',
  })
  withdrawn: boolean;
}
