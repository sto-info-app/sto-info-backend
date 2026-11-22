import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { FleetRecruitmentState } from '../../enums/fleet-recruitment-state.enum';
import {
  MAX_APPLICATION_QUESTIONS,
  MAX_QUESTION_OPTION_LENGTH,
  MAX_QUESTION_OPTIONS,
  MAX_QUESTION_PROMPT_LENGTH,
} from '../application-form.interface';
import { ApplicationQuestionKind } from '../enums/application-question-kind.enum';

/** One question as an editor sends it. */
export class RecruitmentQuestionInputDto {
  @ApiPropertyOptional({
    description:
      'The question’s identifier, to keep it across versions. Omit for a ' +
      'new question.',
  })
  @IsOptional()
  @IsUUID()
  readonly id?: string;

  @ApiProperty({ enum: ApplicationQuestionKind })
  @IsEnum(ApplicationQuestionKind)
  readonly kind: ApplicationQuestionKind;

  @ApiProperty({ description: 'What is asked.' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUESTION_PROMPT_LENGTH)
  readonly prompt: string;

  @ApiProperty({ description: 'Whether it must be answered.' })
  @IsBoolean()
  readonly required: boolean;

  @ApiProperty({
    description: 'The options, for a single-choice question.',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(MAX_QUESTION_OPTIONS)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(MAX_QUESTION_OPTION_LENGTH, { each: true })
  readonly options: string[];
}

/** A new version of how a Fleet recruits. */
export class UpdateRecruitmentSettingsDto {
  @ApiProperty({
    description:
      'The version the editor last saw, 0 when the Fleet has none. A save ' +
      'over a newer one is refused.',
  })
  @IsInt()
  @Min(0)
  readonly expectedVersion: number;

  @ApiProperty({ enum: FleetRecruitmentState })
  @IsEnum(FleetRecruitmentState)
  readonly recruitmentState: FleetRecruitmentState;

  @ApiPropertyOptional({
    description: 'What the Fleet asks of applicants, in its own words.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly requirementsText?: string | null;

  @ApiPropertyOptional({
    description: 'The lowest Character level that may join or apply.',
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly minimumLevel?: number | null;

  @ApiProperty({
    description: 'The factions allowed to join or apply; empty for any.',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  readonly factionIds: string[];

  @ApiProperty({ type: [RecruitmentQuestionInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_APPLICATION_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => RecruitmentQuestionInputDto)
  readonly questions: RecruitmentQuestionInputDto[];
}

/** One question on the form, as it is read. */
export class RecruitmentQuestionDto {
  @ApiProperty({ description: 'The question.' })
  id: string;

  @ApiProperty({ enum: ApplicationQuestionKind })
  kind: ApplicationQuestionKind;

  @ApiProperty({ description: 'What is asked.' })
  prompt: string;

  @ApiProperty({ description: 'Whether it must be answered.' })
  required: boolean;

  @ApiProperty({ type: [String] })
  options: string[];
}

/** A faction a Fleet allows, with its name. */
export class RecruitmentFactionDto {
  @ApiProperty({ description: 'The faction.' })
  id: string;

  @ApiProperty({ description: 'Its name.' })
  name: string;
}

/** How a Fleet recruits now. */
export class RecruitmentSettingsDto {
  @ApiProperty({
    description: 'The version, or 0 when the Fleet has never saved one.',
  })
  version: number;

  @ApiProperty({ enum: FleetRecruitmentState })
  recruitmentState: FleetRecruitmentState;

  @ApiPropertyOptional({ nullable: true })
  requirementsText: string | null;

  @ApiPropertyOptional({ nullable: true })
  minimumLevel: number | null;

  @ApiProperty({ type: [RecruitmentFactionDto] })
  factions: RecruitmentFactionDto[];

  @ApiProperty({ type: [RecruitmentQuestionDto] })
  questions: RecruitmentQuestionDto[];

  @ApiPropertyOptional({
    description: 'When this version was saved.',
    nullable: true,
  })
  savedAt: Date | null;
}
