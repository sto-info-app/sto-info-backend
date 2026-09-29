import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { AdminReasonDto } from 'src/shared/dto/admin-reason.dto';

import {
  RescanCampaignKind,
  RescanCampaignState,
  RescanState,
} from './rescan.enums';

/** The picture kinds a campaign may select: never a roster file. */
export const RESCANNABLE_KINDS = [
  FileAssetKind.PROFILE_IMAGE,
  FileAssetKind.CHARACTER_IMAGE,
  FileAssetKind.STORYTIME_IMAGE,
  FileAssetKind.CUSTOM_TRACKING_IMAGE,
  FileAssetKind.FLEET_IMAGE,
] as const;

/** Which pictures a campaign rescans. Every field narrows it. */
export class RescanSelectionDto {
  @ApiPropertyOptional({ enum: RESCANNABLE_KINDS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(RESCANNABLE_KINDS, { each: true })
  readonly kinds?: FileAssetKind[];

  @ApiPropertyOptional({ description: 'Uploaded on or after, ISO 8601.' })
  @IsOptional()
  @IsISO8601()
  readonly uploadedFrom?: string;

  @ApiPropertyOptional({ description: 'Uploaded before, ISO 8601.' })
  @IsOptional()
  @IsISO8601()
  readonly uploadedBefore?: string;

  @ApiPropertyOptional({
    description: 'Not scanned for this many days, or never.',
    minimum: 0,
    maximum: 3650,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  readonly notScannedForDays?: number;

  @ApiPropertyOptional({ description: 'Only legacy pictures, never scanned.' })
  @IsOptional()
  @IsBoolean()
  readonly unverifiedOnly?: boolean;

  @ApiPropertyOptional({
    enum: ['HIGH', 'LOW'],
    description: 'Ahead of other campaigns, or behind; always behind uploads.',
  })
  @IsOptional()
  @IsIn(['HIGH', 'LOW'])
  readonly priority?: 'HIGH' | 'LOW';
}

/** A site admin starting a campaign, with why. */
export class StartRescanCampaignDto extends AdminReasonDto {
  @ApiProperty({ type: RescanSelectionDto })
  @ValidateNested()
  @Type(() => RescanSelectionDto)
  readonly selection: RescanSelectionDto;
}

/** A campaign, as Scan Diagnostics shows it. */
export class RescanCampaignDto {
  @ApiProperty() id: string;

  @ApiProperty({ enum: RescanCampaignKind }) kind: RescanCampaignKind;

  @ApiProperty({ enum: RescanCampaignState }) state: RescanCampaignState;

  @ApiProperty({ type: Object }) selection: Record<string, unknown>;

  @ApiProperty({
    type: Object,
    description:
      'requested, clean, infected, refused, failed and skipped, as far as they go. Counts only.',
  })
  counts: Record<string, number>;

  @ApiPropertyOptional({ nullable: true, type: String })
  lastError: string | null;

  @ApiProperty() createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  finishedAt: Date | null;
}

/** A refusal or infection, by asset and code. */
export class RescanFindingDto {
  @ApiProperty() assetId: string;

  @ApiProperty({ enum: RescanState }) state: RescanState;

  @ApiPropertyOptional({ nullable: true, type: String })
  rejectionCode: string | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  verdictAt: Date | null;
}

/** Where the campaigns stand. */
export class RescanOverviewDto {
  @ApiProperty({ type: [RescanCampaignDto] })
  campaigns: RescanCampaignDto[];

  @ApiProperty({ description: 'Rescans waiting for a verdict.' })
  waiting: number;

  @ApiProperty({ description: 'Legacy pictures still never scanned.' })
  unverified: number;

  @ApiProperty({ type: [RescanFindingDto] })
  findings: RescanFindingDto[];
}
