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

import { CharacterFleetSummaryDto } from '../../dto/character-fleet.dto';
import { MAX_APPLICATION_QUESTIONS } from '../application-form.interface';
import { ApplicationQuestionKind } from '../enums/application-question-kind.enum';
import { FleetApplicationActionKind } from '../enums/fleet-application-action-kind.enum';
import { FleetApplicationRoute } from '../enums/fleet-application-route.enum';
import { FleetApplicationStatus } from '../enums/fleet-application-status.enum';

/** One answer as an applicant sends it. */
export class ApplicationAnswerInputDto {
  @ApiProperty({ description: 'The question answered.' })
  @IsString()
  @MaxLength(64)
  readonly questionId: string;

  @ApiProperty({
    description: 'Text, the option chosen, or true or false for yes or no.',
    oneOf: [{ type: 'string' }, { type: 'boolean' }],
  })
  readonly value: string | boolean;
}

/** An application to a Fleet. */
export class SubmitFleetApplicationDto {
  @ApiProperty({ description: 'The applicant’s own Character.' })
  @IsUUID()
  readonly characterId: string;

  @ApiProperty({
    description:
      'The form version the applicant answered; refused if the Fleet has ' +
      'changed its form since.',
  })
  @IsInt()
  @Min(0)
  readonly settingsVersion: number;

  @ApiProperty({ type: [ApplicationAnswerInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_APPLICATION_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => ApplicationAnswerInputDto)
  readonly answers: ApplicationAnswerInputDto[];
}

/** Joining an OPEN Fleet, or accepting an invitation, with a Character. */
export class FleetCharacterChoiceDto {
  @ApiProperty({ description: 'The member’s own Character.' })
  @IsUUID()
  readonly characterId: string;
}

/** A decision on an application. */
export class DecideFleetApplicationDto {
  @ApiProperty({ enum: ['ACCEPT', 'REJECT'] })
  @IsIn(['ACCEPT', 'REJECT'])
  readonly decision: 'ACCEPT' | 'REJECT';

  @ApiPropertyOptional({
    description:
      'Why, required to reject. A note on an acceptance is optional. The ' +
      'applicant sees it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly note?: string;

  @ApiProperty({
    description: 'The revision the decider saw; a stale one is refused.',
  })
  @IsInt()
  @Min(1)
  readonly revision: number;
}

/** Which applications a Fleet's inbox lists. */
export class FleetApplicationQueryDto {
  @ApiPropertyOptional({
    enum: FleetApplicationStatus,
    description: 'Only those in this status; PENDING when omitted.',
  })
  @IsOptional()
  @IsEnum(FleetApplicationStatus)
  readonly status?: FleetApplicationStatus;

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

/** The roster's evidence about an applicant's Character. */
export class ApplicationRosterEvidenceDto {
  @ApiProperty({
    description:
      'Whether the Fleet’s latest in-force export lists the Character by ' +
      'its exact name and handle.',
  })
  listed: boolean;

  @ApiPropertyOptional({
    description: 'When that export was taken, or null before any import.',
    nullable: true,
  })
  latestExportAt: Date | null;

  @ApiPropertyOptional({
    description:
      'When the exports began listing the Character continuously, where ' +
      'they list it now.',
    nullable: true,
  })
  listedSince: Date | null;

  @ApiPropertyOptional({
    description: 'Its rank in the latest export, where it is listed.',
    nullable: true,
  })
  rank: string | null;

  @ApiProperty({
    description: 'Whether any export has ever listed the Character here.',
  })
  everListed: boolean;
}

/** One row of a Fleet's application inbox. */
export class FleetApplicationSummaryDto {
  @ApiProperty() id: string;

  @ApiProperty({ enum: FleetApplicationStatus })
  status: FleetApplicationStatus;

  @ApiProperty({ enum: FleetApplicationRoute })
  route: FleetApplicationRoute;

  @ApiPropertyOptional({ nullable: true })
  applicantUsername: string | null;

  @ApiProperty({ description: 'The Character, as Name@handle.' })
  characterName: string;

  @ApiPropertyOptional({ nullable: true })
  characterLevel: number | null;

  @ApiPropertyOptional({ nullable: true })
  factionName: string | null;

  @ApiProperty() submittedAt: Date;

  @ApiPropertyOptional({ nullable: true })
  decidedAt: Date | null;
}

/** A page of a Fleet's applications. */
export class FleetApplicationPageDto {
  @ApiProperty({ type: [FleetApplicationSummaryDto] })
  items: FleetApplicationSummaryDto[];

  @ApiProperty() page: number;

  @ApiProperty() pageSize: number;

  @ApiProperty() total: number;
}

/** One answer, beside the question it answered. */
export class ApplicationAnswerDto {
  @ApiProperty() questionId: string;

  @ApiProperty({ description: 'The question, as the applicant saw it.' })
  prompt: string;

  @ApiProperty({ enum: ApplicationQuestionKind })
  kind: ApplicationQuestionKind;

  @ApiPropertyOptional({
    description: 'The answer, or null for an optional question left blank.',
    oneOf: [{ type: 'string' }, { type: 'boolean' }],
    nullable: true,
  })
  value: string | boolean | null;
}

/** One thing that happened to an application. */
export class FleetApplicationActionDto {
  @ApiProperty({ enum: FleetApplicationActionKind })
  action: FleetApplicationActionKind;

  @ApiPropertyOptional({ nullable: true })
  actorUsername: string | null;

  @ApiPropertyOptional({ nullable: true })
  note: string | null;

  @ApiProperty() at: Date;
}

/** One application in full, for a decider. */
export class FleetApplicationDetailDto extends FleetApplicationSummaryDto {
  @ApiProperty({ type: [ApplicationAnswerDto] })
  answers: ApplicationAnswerDto[];

  @ApiProperty({
    description: 'The form version answered, 0 where the Fleet had none.',
  })
  settingsVersion: number;

  @ApiPropertyOptional({ nullable: true })
  decisionNote: string | null;

  @ApiPropertyOptional({ nullable: true })
  decidedByUsername: string | null;

  @ApiProperty({ description: 'Send it back with a decision.' })
  revision: number;

  @ApiProperty({ type: ApplicationRosterEvidenceDto })
  evidence: ApplicationRosterEvidenceDto;

  @ApiProperty({ type: [FleetApplicationActionDto] })
  history: FleetApplicationActionDto[];
}

/** One of the viewer's own applications. */
export class MyFleetApplicationDto {
  @ApiProperty() id: string;

  @ApiProperty({ type: CharacterFleetSummaryDto })
  fleet: CharacterFleetSummaryDto;

  @ApiProperty({ enum: FleetApplicationStatus })
  status: FleetApplicationStatus;

  @ApiProperty({ enum: FleetApplicationRoute })
  route: FleetApplicationRoute;

  @ApiProperty({ description: 'The Character, as Name@handle.' })
  characterName: string;

  @ApiProperty() submittedAt: Date;

  @ApiPropertyOptional({ nullable: true })
  decidedAt: Date | null;

  @ApiPropertyOptional({
    description: 'The reason for a rejection, or a note on an acceptance.',
    nullable: true,
  })
  decisionNote: string | null;
}
