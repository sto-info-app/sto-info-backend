import { ApiProperty } from '@nestjs/swagger';

import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';

/**
 * Creating a Section.
 *
 * The target scope is not here. It comes from the route, because it is fixed
 * for the life of the Section and putting it in the body would suggest it were
 * one more editable property.
 */
export class CreateCustomTrackingSectionDto {
  @ApiProperty({
    description: 'The heading shown on the Section bar.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH,
    example: 'Ship collection',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH)
  name: string;

  @ApiProperty({
    description: 'What the Section is for.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH)
  description: string | null = null;

  @ApiProperty({
    description:
      'Whether the Section may be shown publicly. Off unless asked for.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  publiclyVisible = false;
}

/**
 * Changing a Section.
 *
 * Every property is optional, and absent means "leave it alone" rather than
 * "clear it". A partial update that silently blanked what it did not mention
 * would lose a description the moment somebody renamed a Section.
 */
export class UpdateCustomTrackingSectionDto {
  @ApiProperty({
    description: 'The heading shown on the Section bar.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH,
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH)
  name?: string;

  @ApiProperty({
    description: 'What the Section is for.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiProperty({
    description: 'Whether the Section may be shown publicly.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  publiclyVisible?: boolean;
}

/**
 * A Section as its owner sees it.
 */
export class CustomTrackingSectionDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({
    description: 'Whether it describes Accounts or Characters.',
    enum: CustomTrackingTargetScope,
  })
  targetScope: CustomTrackingTargetScope;

  @ApiProperty({ description: 'The heading shown on the Section bar.' })
  name: string;

  @ApiProperty({ description: 'What the Section is for.', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Position among its siblings.' })
  orderIndex: number;

  @ApiProperty({ description: 'Whether it may be shown publicly.' })
  publiclyVisible: boolean;

  @ApiProperty({
    description: 'Whether an administrator has suppressed it from public view.',
  })
  suppressed: boolean;
}
