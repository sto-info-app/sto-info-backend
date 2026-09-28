import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** The longest reason kept for a change. */
export const MAX_HOLDING_REASON_LENGTH = 500;

/** One track of a holding, where the Fleet has it now. */
export class FleetHoldingTrackDto {
  @ApiProperty({ description: 'Stable code, such as STARBASE_MILITARY.' })
  code: string;

  @ApiProperty({ description: 'Its name in game.' })
  name: string;

  @ApiProperty({
    description: 'Whether it is a department, rather than the holding itself.',
  })
  isDepartment: boolean;

  @ApiProperty({ description: 'Its highest tier. The lowest is 0.' })
  maxTier: number;

  @ApiProperty({ description: 'Its tier now: 0 until one is recorded.' })
  tier: number;

  @ApiPropertyOptional({
    description: 'When it was last recorded, or null when it never has been.',
    nullable: true,
  })
  updatedAt: Date | null;
}

/** One holding, with its tracks. */
export class FleetHoldingDto {
  @ApiProperty({ description: 'Stable code, such as STARBASE.' })
  code: string;

  @ApiProperty({ description: 'Its name in game.' })
  name: string;

  @ApiProperty({ description: 'The wiki page its tiers were read from.' })
  sourceUrl: string;

  @ApiProperty({ description: 'The day that page was last edited.' })
  sourceEditedOn: string;

  @ApiProperty({
    type: [FleetHoldingTrackDto],
    description: 'Its own track first, then its departments.',
  })
  tracks: FleetHoldingTrackDto[];
}

/** A Fleet's holdings, for whoever may see the Fleet. */
export class FleetHoldingsDto {
  @ApiProperty({ description: 'The catalogue version the tiers come from.' })
  catalogueVersion: number;

  @ApiProperty({
    description:
      'Whether the viewer may record tiers: `holdings.write` at an open Fleet.',
  })
  mayRecord: boolean;

  @ApiProperty({ type: [FleetHoldingDto] })
  holdings: FleetHoldingDto[];
}

/** One track to set. */
export class FleetHoldingTierInputDto {
  @ApiProperty({ description: 'The track’s code.' })
  @IsString()
  @MaxLength(60)
  readonly track: string;

  @ApiProperty({ description: 'The tier to record.' })
  @IsInt()
  @Min(0)
  @Max(100)
  readonly tier: number;
}

/** Records the tiers of one holding's tracks. */
export class RecordFleetHoldingDto {
  @ApiProperty({
    type: [FleetHoldingTierInputDto],
    description:
      'The tracks to set. Tracks left out stay as they are, and so do ' +
      'those already at the tier given.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => FleetHoldingTierInputDto)
  readonly tiers: FleetHoldingTierInputDto[];

  @ApiPropertyOptional({ description: 'Why, for the record. Optional.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HOLDING_REASON_LENGTH)
  readonly reason?: string;
}

/** Which page of a Fleet's holdings history to read. */
export class FleetHoldingHistoryQueryDto {
  @ApiPropertyOptional({ description: 'The page, from 1.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({ description: 'Changes per page, at most 100.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize?: number;
}

/** One track a change moved. */
export class FleetHoldingTrackMoveDto {
  @ApiProperty() track: string;

  @ApiProperty() trackName: string;

  @ApiProperty() isDepartment: boolean;

  @ApiProperty({ description: 'Its tier before.' }) from: number;

  @ApiProperty({ description: 'Its tier after.' }) to: number;
}

/** One save of one holding. */
export class FleetHoldingChangeDto {
  @ApiProperty() id: string;

  @ApiProperty() holdingCode: string;

  @ApiProperty() holdingName: string;

  @ApiProperty({ description: 'When it was recorded.' })
  recordedAt: Date;

  @ApiPropertyOptional({
    description:
      'Who recorded it: shown to the Fleet’s members alone, and null to ' +
      'anybody else, or once their account has gone.',
    nullable: true,
  })
  recordedBy: string | null;

  @ApiPropertyOptional({ nullable: true }) reason: string | null;

  @ApiProperty({
    type: [FleetHoldingTrackMoveDto],
    description: 'The holding’s own track first, then its departments.',
  })
  moves: FleetHoldingTrackMoveDto[];
}

/** A page of a Fleet's holdings history, newest first. */
export class FleetHoldingHistoryPageDto {
  @ApiProperty({ type: [FleetHoldingChangeDto] })
  items: FleetHoldingChangeDto[];

  @ApiProperty({
    description: 'Whether the viewer is shown who recorded each change.',
  })
  recordersShown: boolean;

  @ApiProperty() page: number;

  @ApiProperty() pageSize: number;

  @ApiProperty() total: number;
}
