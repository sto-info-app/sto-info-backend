import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { RosterIdentityDecisionAction } from '../enums/roster-identity-decision-action.enum';

/** The longest reason a decision may give, as the column holds it. */
export const ROSTER_IDENTITY_REASON_MAX_LENGTH = 500;

/**
 * Trims a reason, and treats one that was only whitespace as not given.
 *
 * @param params - What class-transformer hands a transform.
 * @param params.value - The value as sent.
 * @returns The trimmed reason, or undefined for a blank one.
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

/**
 * A reviewer's decision on a rename candidate.
 *
 * `revision` is the candidate's revision as the reviewer saw it. A decision
 * naming any other is refused, so two reviewers looking at the same candidate
 * cannot both act on what they saw: the second is told it has changed.
 *
 * A reason is optional for confirming and rejecting, where the evidence and
 * its confidence already say why, and required for undoing, which overturns
 * somebody's decision. Steve's decision of 24 September 2026.
 */
export class DecideRosterIdentityCandidateDto {
  @ApiProperty({ enum: RosterIdentityDecisionAction })
  @IsEnum(RosterIdentityDecisionAction)
  readonly action: RosterIdentityDecisionAction;

  @ApiProperty({
    description: 'The candidate’s revision as the reviewer saw it.',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  readonly revision: number;

  @ApiPropertyOptional({
    description: 'Why. Required to undo a decision.',
    maxLength: ROSTER_IDENTITY_REASON_MAX_LENGTH,
  })
  @Transform(trim)
  @ValidateIf(
    (dto: DecideRosterIdentityCandidateDto) =>
      dto.action === RosterIdentityDecisionAction.UNDO ||
      dto.reason !== undefined,
  )
  @IsString()
  @IsNotEmpty({ message: 'Say why the decision is being undone.' })
  @MaxLength(ROSTER_IDENTITY_REASON_MAX_LENGTH)
  readonly reason?: string;
}
