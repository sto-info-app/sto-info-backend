import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum } from 'class-validator';

import { AdminReasonDto } from 'src/shared/dto/admin-reason.dto';

import {
  ImageEstateRunKind,
  ImageEstateRunState,
  ImageEstateStepState,
  ImageInventoryRunState,
} from './image-estate.enums';

/** A site admin starting a run, with why. */
export class StartImageEstateRunDto extends AdminReasonDto {
  @ApiProperty({ enum: ImageEstateRunKind })
  @IsEnum(ImageEstateRunKind)
  readonly kind: ImageEstateRunKind;
}

/** A run, as Scan Diagnostics shows it. */
export class ImageEstateRunDto {
  @ApiProperty() id: string;

  @ApiProperty({ enum: ImageEstateRunKind }) kind: ImageEstateRunKind;

  @ApiProperty({ enum: ImageEstateRunState }) state: ImageEstateRunState;

  @ApiProperty({
    description:
      'registered, copied, undone, retired and failed, as far as they go.',
  })
  counts: Record<string, number>;

  @ApiPropertyOptional({ nullable: true, type: String })
  lastError: string | null;

  @ApiProperty() createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  finishedAt: Date | null;
}

/** An inventory, as Scan Diagnostics shows it. */
export class ImageInventoryDto {
  @ApiProperty() id: string;

  @ApiProperty({ enum: ImageInventoryRunState }) state: ImageInventoryRunState;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Counts: references by column, the registry by kind and state, the ' +
      'copies by state, and Cloudflare against both. IDs only, never content.',
  })
  report: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  error: string | null;

  @ApiProperty() createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  finishedAt: Date | null;
}

/** Where the image estate stands. */
export class ImageEstateStatusDto {
  @ApiProperty({
    description: 'Whether addresses are signed, which a copy needs.',
  })
  signingEnabled: boolean;

  @ApiProperty({ description: 'Published pictures still public.' })
  remaining: number;

  @ApiProperty({
    description: 'Each picture copy, counted by state.',
    example: { [ImageEstateStepState.COPIED]: 3 },
  })
  steps: Partial<Record<ImageEstateStepState, number>>;

  @ApiPropertyOptional({ nullable: true, type: ImageEstateRunDto })
  run: ImageEstateRunDto | null;

  @ApiPropertyOptional({ nullable: true, type: ImageInventoryDto })
  inventory: ImageInventoryDto | null;
}
