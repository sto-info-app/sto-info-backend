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
 * Creating a Tab.
 *
 * The Section it belongs to comes from the route. A Tab cannot be moved
 * between Sections, so its parent is part of where it lives rather than
 * something the body describes.
 */
export class CreateCustomTrackingTabDto {
  @ApiProperty({
    description: 'The label on the tab itself.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH,
    example: 'Escorts',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH)
  name: string;

  @ApiProperty({
    description: 'What the Tab groups together.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH)
  description: string | null = null;

  @ApiProperty({
    description: 'Whether the Tab may be shown publicly. Off unless asked for.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  publiclyVisible = false;
}

/**
 * Changing a Tab. Absent means leave alone, not clear.
 */
export class UpdateCustomTrackingTabDto {
  @ApiProperty({
    description: 'The label on the tab itself.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH,
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_LABEL_LENGTH)
  name?: string;

  @ApiProperty({
    description: 'What the Tab groups together.',
    maxLength: CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_TRACKING_LIMITS.MAX_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiProperty({
    description: 'Whether the Tab may be shown publicly.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  publiclyVisible?: boolean;
}

/**
 * A Tab as its owner sees it.
 */
export class CustomTrackingTabDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Section it belongs to.' })
  sectionId: string;

  @ApiProperty({ description: 'The label on the tab itself.' })
  name: string;

  @ApiProperty({ description: 'What the Tab groups together.', nullable: true })
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
