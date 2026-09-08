import { ApiProperty } from '@nestjs/swagger';

import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import {
  CreateCustomTrackingDefinitionDto,
  UpdateCustomTrackingDefinitionDto,
} from './custom-tracking-definition.dto';
import { CustomTrackingOptionDto } from './custom-tracking-option.dto';

/**
 * Creating a Field.
 *
 * The type is set here and never again. It decides how every value recorded
 * against the Field is stored, validated and rendered, so it is the one
 * property whose choice is permanent.
 */
export class CreateCustomTrackingFieldDto extends CreateCustomTrackingDefinitionDto {
  @ApiProperty({
    description: 'The kind of answer this Field asks for. Cannot be changed.',
    enum: CustomTrackingFieldType,
  })
  @IsEnum(CustomTrackingFieldType)
  fieldType: CustomTrackingFieldType;

  @ApiProperty({
    description:
      'Whether a value is required before the record being edited can be saved.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  required = false;

  @ApiProperty({
    description: 'What the owner sees where this Field has no value.',
    enum: CustomTrackingEmptyMode,
    default: CustomTrackingEmptyMode.SHOW_LABEL,
  })
  @IsOptional()
  @IsEnum(CustomTrackingEmptyMode)
  ownerEmptyMode: CustomTrackingEmptyMode = CustomTrackingEmptyMode.SHOW_LABEL;

  @ApiProperty({
    description: 'What the public sees where this Field has no value.',
    enum: CustomTrackingEmptyMode,
    default: CustomTrackingEmptyMode.HIDE,
  })
  @IsOptional()
  @IsEnum(CustomTrackingEmptyMode)
  publicEmptyMode: CustomTrackingEmptyMode = CustomTrackingEmptyMode.HIDE;

  @ApiProperty({
    description:
      'The text shown where a value is absent and the mode calls for one. Shared by both views.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_PLACEHOLDER_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_PLACEHOLDER_LENGTH)
  emptyPlaceholder: string | null = null;

  @ApiProperty({
    description:
      'Type-specific settings. What belongs here depends entirely on the field type, and is checked against it.',
    type: Object,
    example: { minLength: 2, maxLength: 40 },
  })
  @IsObject()
  configuration: Record<string, unknown>;
}

/**
 * Changing a Field.
 *
 * The type is absent, and a request naming one is refused rather than ignored,
 * so a user who believed they were changing it finds out that they were not.
 */
export class UpdateCustomTrackingFieldDto extends UpdateCustomTrackingDefinitionDto {
  @ApiProperty({
    description: 'Whether a value is required to save the record being edited.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiProperty({
    description: 'What the owner sees where this Field has no value.',
    enum: CustomTrackingEmptyMode,
    required: false,
  })
  @IsOptional()
  @IsEnum(CustomTrackingEmptyMode)
  ownerEmptyMode?: CustomTrackingEmptyMode;

  @ApiProperty({
    description: 'What the public sees where this Field has no value.',
    enum: CustomTrackingEmptyMode,
    required: false,
  })
  @IsOptional()
  @IsEnum(CustomTrackingEmptyMode)
  publicEmptyMode?: CustomTrackingEmptyMode;

  @ApiProperty({
    description: 'The text shown where a value is absent.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_PLACEHOLDER_LENGTH,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_PLACEHOLDER_LENGTH)
  emptyPlaceholder?: string | null;

  @ApiProperty({
    description:
      'Type-specific settings, checked against the type the Field already has.',
    type: Object,
    required: false,
  })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

/**
 * A Field as its owner sees it.
 */
export class CustomTrackingFieldDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Tab it belongs to.' })
  tabId: string;

  @ApiProperty({
    description: 'The kind of answer it asks for.',
    enum: CustomTrackingFieldType,
  })
  fieldType: CustomTrackingFieldType;

  @ApiProperty({ description: 'The label shown beside the answer.' })
  name: string;

  @ApiProperty({ description: 'Help text.', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Position among its siblings.' })
  orderIndex: number;

  @ApiProperty({ description: 'Whether it may be shown publicly.' })
  publiclyVisible: boolean;

  @ApiProperty({ description: 'Whether a value is required to save a record.' })
  required: boolean;

  @ApiProperty({
    description: 'What the owner sees where it has no value.',
    enum: CustomTrackingEmptyMode,
  })
  ownerEmptyMode: CustomTrackingEmptyMode;

  @ApiProperty({
    description: 'What the public sees where it has no value.',
    enum: CustomTrackingEmptyMode,
  })
  publicEmptyMode: CustomTrackingEmptyMode;

  @ApiProperty({ description: 'The text shown where empty.', nullable: true })
  emptyPlaceholder: string | null;

  @ApiProperty({ description: 'Type-specific settings.', type: Object })
  configuration: Record<string, unknown>;

  @ApiProperty({
    description: 'Whether an administrator has suppressed it from public view.',
  })
  suppressed: boolean;

  @ApiProperty({
    description: 'The answers it offers, for the types that draw from a list.',
    type: [CustomTrackingOptionDto],
  })
  options: CustomTrackingOptionDto[];
}
