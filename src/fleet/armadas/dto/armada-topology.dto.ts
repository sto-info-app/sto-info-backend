import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { ArmadaPosition } from '../../enums/armada-position.enum';
import { ArmadaActionKind } from '../enums/armada-action-kind.enum';
import { ArmadaJoinRequestStatus } from '../enums/armada-join-request-status.enum';

/** The longest message or reason kept. */
export const MAX_ARMADA_TEXT_LENGTH = 500;

/** How many days a request stays open. */
export const ARMADA_REQUEST_DAYS = 14;

/** What becomes of a Gamma whose Beta leaves or moves. */
export const GAMMA_OUTCOMES = ['BETA', 'GAMMA', 'LEAVE'] as const;

/** One of those. */
export type GammaOutcome = (typeof GAMMA_OUTCOMES)[number];

/** A Fleet, as an Armada's pages name it. */
export class ArmadaFleetRefDto {
  @ApiPropertyOptional({
    description: 'The Fleet, or null when the reader may not see it.',
    nullable: true,
  })
  id: string | null;

  @ApiPropertyOptional({
    description: 'Its name in game, or null when hidden.',
    nullable: true,
  })
  name: string | null;

  @ApiPropertyOptional({
    description: 'Its URL segment, or null when hidden.',
    nullable: true,
  })
  slug: string | null;

  @ApiProperty({ description: 'Its platform, as a URL segment.' })
  platformSegment: string;
}

/** An Armada, as a Fleet's pages name it. */
export class ArmadaRefDto {
  @ApiProperty() id: string;

  @ApiProperty({ description: 'Its name in game.' }) name: string;

  @ApiProperty() slug: string;

  @ApiProperty({ description: 'Its platform, as a URL segment.' })
  platformSegment: string;

  @ApiPropertyOptional({
    description: 'Its allegiance, Federation or Klingon, if set.',
    nullable: true,
  })
  allegiance: string | null;
}

/** One Fleet where it sits now. */
export class ArmadaNodeDto {
  @ApiProperty({ type: ArmadaFleetRefDto }) fleet: ArmadaFleetRefDto;

  @ApiProperty({ enum: ArmadaPosition }) position: ArmadaPosition;

  @ApiProperty({ description: 'When it took this place.' }) since: Date;
}

/** A Beta, with the Gammas under it. */
export class ArmadaBetaDto extends ArmadaNodeDto {
  @ApiProperty({ type: [ArmadaNodeDto] }) gammas: ArmadaNodeDto[];
}

/** An Armada's shape now. */
export class ArmadaStructureDto {
  @ApiPropertyOptional({
    type: ArmadaNodeDto,
    description: 'The Alpha, or null while the slot stands empty.',
    nullable: true,
  })
  alpha: ArmadaNodeDto | null;

  @ApiProperty({ type: [ArmadaBetaDto] }) betas: ArmadaBetaDto[];

  @ApiProperty({ description: 'The most Betas it may have.' })
  maxBetas: number;

  @ApiProperty({ description: 'The most Gammas one Beta may have.' })
  maxGammasPerBeta: number;
}

/** An Armada's shape, for one reader. */
export class ArmadaViewDto {
  @ApiProperty({ type: ArmadaStructureDto }) structure: ArmadaStructureDto;

  @ApiProperty({
    description:
      'Whether the reader may decide requests and arrange it: ' +
      '`armada.manage` at an open Armada.',
  })
  mayManage: boolean;

  @ApiProperty({
    description:
      'Whether the reader is its member, through a Fleet placed in it, or ' +
      'holds a role there.',
  })
  isMember: boolean;

  @ApiProperty({ description: 'Open requests, for a manager; otherwise 0.' })
  openRequests: number;
}

/** Where a Fleet was or went. */
export class ArmadaPlaceDto {
  @ApiProperty({ enum: ArmadaPosition }) position: ArmadaPosition;

  @ApiPropertyOptional({
    type: ArmadaFleetRefDto,
    description: 'The Beta, for a Gamma.',
    nullable: true,
  })
  parent: ArmadaFleetRefDto | null;
}

/** One Fleet a change moved. */
export class ArmadaMoveDto {
  @ApiProperty({ type: ArmadaFleetRefDto }) fleet: ArmadaFleetRefDto;

  @ApiProperty({ enum: ArmadaActionKind }) action: ArmadaActionKind;

  @ApiPropertyOptional({ type: ArmadaPlaceDto, nullable: true })
  from: ArmadaPlaceDto | null;

  @ApiPropertyOptional({ type: ArmadaPlaceDto, nullable: true })
  to: ArmadaPlaceDto | null;
}

/** One change to an Armada's shape. */
export class ArmadaChangeDto {
  @ApiProperty() changeId: string;

  @ApiProperty({ description: 'When it was made.' }) at: Date;

  @ApiPropertyOptional({
    description:
      'Who made it: shown to the Armada’s members alone, and null to ' +
      'anybody else, or once their account has gone.',
    nullable: true,
  })
  recordedBy: string | null;

  @ApiPropertyOptional({
    description: 'Why: shown to the Armada’s members alone.',
    nullable: true,
  })
  reason: string | null;

  @ApiProperty({ type: [ArmadaMoveDto] }) moves: ArmadaMoveDto[];
}

/** Which page of an Armada's history to read. */
export class ArmadaPageQueryDto {
  @ApiPropertyOptional({ description: 'The page, from 1.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({ description: 'Rows per page, at most 100.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize?: number;
}

/** A page of an Armada's history, newest first. */
export class ArmadaHistoryPageDto {
  @ApiProperty({ type: [ArmadaChangeDto] }) items: ArmadaChangeDto[];

  @ApiProperty({
    description: 'Whether the reader is shown who made each change and why.',
  })
  recordersShown: boolean;

  @ApiProperty() page: number;

  @ApiProperty() pageSize: number;

  @ApiProperty() total: number;
}

/** A request, as its Fleet's managers and the Armada's managers see it. */
export class ArmadaRequestDto {
  @ApiProperty() id: string;

  @ApiProperty({
    enum: ArmadaJoinRequestStatus,
    description: 'LAPSED once past its expiry, even before the sweep.',
  })
  status: ArmadaJoinRequestStatus;

  @ApiProperty({ type: ArmadaRefDto }) armada: ArmadaRefDto;

  @ApiProperty({ type: ArmadaFleetRefDto }) fleet: ArmadaFleetRefDto;

  @ApiPropertyOptional({ nullable: true }) requestedBy: string | null;

  @ApiPropertyOptional({ nullable: true }) message: string | null;

  @ApiProperty() createdAt: Date;

  @ApiProperty() expiresAt: Date;

  @ApiPropertyOptional({ nullable: true }) answeredAt: Date | null;

  @ApiPropertyOptional({ nullable: true }) answeredBy: string | null;

  @ApiPropertyOptional({
    description: 'Why it was rejected.',
    nullable: true,
  })
  reason: string | null;
}

/** Which of an Armada's requests to list. */
export class ArmadaRequestQueryDto extends ArmadaPageQueryDto {
  @ApiPropertyOptional({
    enum: ArmadaJoinRequestStatus,
    description: 'Only those in this status; PENDING when omitted.',
  })
  @IsOptional()
  @IsEnum(ArmadaJoinRequestStatus)
  readonly status?: ArmadaJoinRequestStatus;
}

/** A page of an Armada's requests. */
export class ArmadaRequestPageDto {
  @ApiProperty({ type: [ArmadaRequestDto] }) items: ArmadaRequestDto[];

  @ApiProperty() page: number;

  @ApiProperty() pageSize: number;

  @ApiProperty() total: number;
}

/** Asks for a Fleet to join an Armada. */
export class CreateArmadaRequestDto {
  @ApiProperty({ description: 'The Armada.' })
  @IsUUID()
  readonly armadaId: string;

  @ApiPropertyOptional({ description: 'Anything to say. Optional.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ARMADA_TEXT_LENGTH)
  readonly message?: string;
}

/** Where a Fleet goes. */
export class ArmadaSlotDto {
  @ApiProperty({ enum: ArmadaPosition })
  @IsEnum(ArmadaPosition)
  readonly position: ArmadaPosition;

  @ApiPropertyOptional({ description: 'The Beta, for a Gamma.' })
  @IsOptional()
  @IsUUID()
  readonly parentFleetId?: string;
}

/** What becomes of one Gamma whose Beta leaves or moves. */
export class GammaResolutionDto {
  @ApiProperty({ description: 'The Gamma.' })
  @IsUUID()
  readonly fleetId: string;

  @ApiProperty({
    enum: GAMMA_OUTCOMES,
    description:
      'BETA to become a Beta, GAMMA to move under another Beta, LEAVE to ' +
      'come out of the Armada too.',
  })
  @IsIn(GAMMA_OUTCOMES)
  readonly outcome: GammaOutcome;

  @ApiPropertyOptional({ description: 'The Beta, for GAMMA.' })
  @IsOptional()
  @IsUUID()
  readonly parentFleetId?: string;
}

/** A reason that has to be given. */
export class ArmadaReasonDto {
  @ApiProperty({ description: 'Why, for the record. Required.' })
  @IsString()
  @MaxLength(MAX_ARMADA_TEXT_LENGTH)
  readonly reason: string;
}

/** Moves a placed Fleet. */
export class MoveArmadaFleetDto extends ArmadaSlotDto {
  @ApiProperty({ description: 'Why, for the record. Required.' })
  @IsString()
  @MaxLength(MAX_ARMADA_TEXT_LENGTH)
  readonly reason: string;

  @ApiPropertyOptional({
    type: [GammaResolutionDto],
    description: 'For a Beta that stops being one: each of its Gammas.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => GammaResolutionDto)
  readonly gammas?: GammaResolutionDto[];
}

/** Takes a Fleet out of an Armada. */
export class RemoveArmadaFleetDto extends ArmadaReasonDto {
  @ApiPropertyOptional({
    type: [GammaResolutionDto],
    description: 'For a Beta: each of its Gammas.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => GammaResolutionDto)
  readonly gammas?: GammaResolutionDto[];
}

/** Where a Fleet sits in an Armada now. */
export class FleetPlacementDto {
  @ApiProperty({ type: ArmadaRefDto }) armada: ArmadaRefDto;

  @ApiProperty({ enum: ArmadaPosition }) position: ArmadaPosition;

  @ApiPropertyOptional({
    type: ArmadaFleetRefDto,
    description: 'The Beta, for a Gamma.',
    nullable: true,
  })
  parent: ArmadaFleetRefDto | null;

  @ApiProperty() since: Date;

  @ApiProperty({
    description: 'How many Gammas sit under it, for a Beta.',
  })
  gammaCount: number;
}

/** A Fleet's Armada, for its page. */
export class FleetArmadaViewDto {
  @ApiPropertyOptional({
    type: FleetPlacementDto,
    description: 'Where it sits, or null when it is in no Armada.',
    nullable: true,
  })
  placement: FleetPlacementDto | null;

  @ApiProperty({
    description:
      'Whether the reader may ask to join and take the Fleet out: ' +
      '`armada.request` at an open Fleet. What follows is for them alone.',
  })
  mayRequest: boolean;

  @ApiPropertyOptional({ type: ArmadaRequestDto, nullable: true })
  openRequest: ArmadaRequestDto | null;

  @ApiPropertyOptional({
    type: ArmadaRequestDto,
    description: 'The last request answered, for its outcome and reason.',
    nullable: true,
  })
  lastAnswered: ArmadaRequestDto | null;

  @ApiProperty({
    type: [ArmadaRefDto],
    description:
      'The open Armadas of its Community it could ask to join: the same ' +
      'platform and allegiance. Empty unless it may ask now.',
  })
  choices: ArmadaRefDto[];

  @ApiPropertyOptional({
    description:
      'Why it cannot ask, when it may not: no allegiance, say. Null when it can.',
    nullable: true,
  })
  cannotRequestBecause: string | null;
}

/** One of a Community's Armadas, with its shape. */
export class CommunityArmadaDto {
  @ApiProperty({ type: ArmadaRefDto }) armada: ArmadaRefDto;

  @ApiProperty({ type: ArmadaStructureDto }) structure: ArmadaStructureDto;
}

/** A Community's Armadas, and the Fleets in none. */
export class CommunityStructureDto {
  @ApiProperty({ type: [CommunityArmadaDto] }) armadas: CommunityArmadaDto[];

  @ApiProperty({
    type: [ArmadaFleetRefDto],
    description: 'Its open Fleets the reader may see that are in no Armada.',
  })
  standaloneFleets: ArmadaFleetRefDto[];
}
