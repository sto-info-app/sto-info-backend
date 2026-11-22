import { ApiProperty } from '@nestjs/swagger';

import { RosterIdentityCandidateKind } from '../enums/roster-identity-candidate-kind.enum';
import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';
import { RosterIdentityCollisionReason } from '../enums/roster-identity-collision-reason.enum';
import { RosterIdentityConfidence } from '../enums/roster-identity-confidence.enum';
import { RosterIdentityDecisionAction } from '../enums/roster-identity-decision-action.enum';
import { RosterIdentitySignal } from '../enums/roster-identity-signal.enum';

/** One exact name and handle a Fleet's roster has used. */
export class RosterIdentityAliasDto {
  @ApiProperty({ description: 'The alias.' })
  aliasId: string;

  @ApiProperty({ description: 'The roster identity it belongs to now.' })
  identityId: string;

  @ApiProperty({ description: 'The Character name, as first exported.' })
  characterName: string;

  @ApiProperty({ description: 'The account handle, as first exported.' })
  accountHandle: string;

  @ApiProperty({
    description:
      'The earliest in-force export listing it, or null while none does.',
    nullable: true,
  })
  firstObservedAt: Date | null;

  @ApiProperty({
    description: 'The latest in-force export listing it, or null.',
    nullable: true,
  })
  lastObservedAt: Date | null;
}

/** One pair of aliases a candidate would join. */
export class RosterIdentityLinkDto {
  @ApiProperty({ type: RosterIdentityAliasDto, description: 'The old name.' })
  from: RosterIdentityAliasDto;

  @ApiProperty({ type: RosterIdentityAliasDto, description: 'The new name.' })
  to: RosterIdentityAliasDto;
}

/** An export a candidate rests on. */
export class RosterIdentityEvidenceDto {
  @ApiProperty({ description: 'The import.' })
  importId: string;

  @ApiProperty({
    description: 'When its export was taken.',
    nullable: true,
  })
  exportedAt: Date | null;
}

/** One corroborating check, and how it came out. */
export class RosterIdentitySignalDto {
  @ApiProperty({ enum: RosterIdentitySignal })
  signal: RosterIdentitySignal;

  @ApiProperty({
    description: 'Whether it held, or null where it could not be checked.',
    nullable: true,
    type: Boolean,
  })
  held: boolean | null;
}

/** One thing a reviewer did. */
export class RosterIdentityDecisionDto {
  @ApiProperty({ enum: RosterIdentityDecisionAction })
  action: RosterIdentityDecisionAction;

  @ApiProperty({ enum: RosterIdentityCandidateState })
  fromState: RosterIdentityCandidateState;

  @ApiProperty({ enum: RosterIdentityCandidateState })
  toState: RosterIdentityCandidateState;

  @ApiProperty({ description: 'Which decision on the candidate it was.' })
  revision: number;

  @ApiProperty({ description: 'Why, if they said.', nullable: true })
  reason: string | null;

  @ApiProperty({ description: 'When.' })
  decidedAt: Date;

  @ApiProperty({
    description:
      "The reviewer's STO Info username, or null once their account is gone.",
    nullable: true,
  })
  actorUsername: string | null;
}

/**
 * A rename the evidence suggests, with everything a reviewer needs to judge
 * it and everything that has been decided about it.
 *
 * For roster investigators only. It names Characters and account handles as
 * exported, which `roster.investigate` is the capability for; it says nothing
 * of any STO Info account, because nothing here is linked to one.
 */
export class RosterIdentityCandidateDto {
  @ApiProperty({ description: 'The candidate.' })
  id: string;

  @ApiProperty({ enum: RosterIdentityCandidateKind })
  kind: RosterIdentityCandidateKind;

  @ApiProperty({ enum: RosterIdentityCandidateState })
  state: RosterIdentityCandidateState;

  @ApiProperty({
    description:
      'Whether it may be confirmed or rejected now: open, and not a collision.',
  })
  decidable: boolean;

  @ApiProperty({ enum: RosterIdentityConfidence })
  confidence: RosterIdentityConfidence;

  @ApiProperty({ type: [RosterIdentitySignalDto] })
  signals: RosterIdentitySignalDto[];

  @ApiProperty({
    enum: RosterIdentityCollisionReason,
    isArray: true,
    description: 'Why it cannot be resolved. Empty when it can.',
  })
  collisionReasons: RosterIdentityCollisionReason[];

  @ApiProperty({
    description: 'Whether its evidence has changed since it was decided.',
  })
  stale: boolean;

  @ApiProperty({
    description: 'The revision a decision on it must name to be accepted.',
  })
  revision: number;

  @ApiProperty({
    type: RosterIdentityEvidenceDto,
    description: 'The export the old name was last seen in.',
  })
  earlier: RosterIdentityEvidenceDto;

  @ApiProperty({
    type: RosterIdentityEvidenceDto,
    description: 'The export the new name was first seen in.',
  })
  later: RosterIdentityEvidenceDto;

  @ApiProperty({
    type: [RosterIdentityLinkDto],
    description:
      'The pairs it would join: one for a Character rename, one per ' +
      'Character for an account rename.',
  })
  links: RosterIdentityLinkDto[];

  @ApiProperty({
    type: [RosterIdentityDecisionDto],
    description: 'Every decision taken on it, newest first.',
  })
  decisions: RosterIdentityDecisionDto[];

  @ApiProperty({ description: 'When it was first suggested.' })
  createdAt: Date;
}

/** A page of a Fleet's rename candidates, open ones first. */
export class RosterIdentityCandidatePageDto {
  @ApiProperty({ type: [RosterIdentityCandidateDto] })
  items: RosterIdentityCandidateDto[];

  @ApiProperty({ description: 'How many match.', example: 3 })
  total: number;

  @ApiProperty({ description: 'The page returned.', example: 1 })
  page: number;

  @ApiProperty({ description: 'Candidates per page.', example: 20 })
  pageSize: number;
}
