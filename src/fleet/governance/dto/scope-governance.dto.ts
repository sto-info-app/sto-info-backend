import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeCapabilityEffect } from '../../enums/scope-capability-effect.enum';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';

/** The role labels an Owner may give. Owner is given only by a transfer. */
export const APPOINTABLE_ROLES = [
  FleetScopeRole.ADMIN,
  FleetScopeRole.OFFICER,
] as const;

/** A role label an Owner may give. */
export type AppointableRole = (typeof APPOINTABLE_ROLES)[number];

/** The longest reason kept. */
export const MAX_GOVERNANCE_REASON_LENGTH = 500;

/** Somebody named on the Manage pages. */
export class GovernancePersonDto {
  @ApiProperty({ description: 'The user.' })
  userId: string;

  @ApiPropertyOptional({
    description: 'Their STO Info username, or null when they have none.',
    nullable: true,
  })
  username: string | null;
}

/** A role label somebody holds here. */
export class ScopeRoleHolderDto extends GovernancePersonDto {
  @ApiProperty({ description: 'The assignment, to withdraw it by.' })
  assignmentId: string;

  @ApiProperty({ enum: APPOINTABLE_ROLES })
  role: FleetScopeRole;

  @ApiProperty({ description: 'When they were given it.' })
  since: Date;
}

/** A capability given to or taken from one person here. */
export class PersonalCapabilityDto extends GovernancePersonDto {
  @ApiProperty({ description: 'The grant, to clear it by.' })
  grantId: string;

  @ApiProperty({ description: 'The capability code.' })
  capability: string;

  @ApiProperty({ enum: ScopeCapabilityEffect })
  effect: ScopeCapabilityEffect;

  @ApiProperty({ description: 'Since when.' })
  since: Date;
}

/** A capability an Owner may delegate here. */
export class DelegableCapabilityDto {
  @ApiProperty({ description: 'The capability code.' })
  code: string;

  @ApiProperty({ description: 'Its name.' })
  name: string;

  @ApiProperty({ description: 'What it allows.' })
  description: string;
}

/** Who governs a Community or Fleet, for its Manage pages. */
export class ScopeRolesDto {
  @ApiProperty({
    type: GovernancePersonDto,
    nullable: true,
    description:
      'The Owner, or null for a closed Community whose Owner’s account was ' +
      'erased (FC-038).',
  })
  owner: GovernancePersonDto | null;

  @ApiProperty({
    description: 'Whether the reader may change any of this.',
  })
  mayManage: boolean;

  @ApiProperty({ type: [ScopeRoleHolderDto] })
  holders: ScopeRoleHolderDto[];

  @ApiProperty({
    type: [GovernancePersonDto],
    description:
      'Who may be given a role here: the approved members of the Fleet, or ' +
      'of any Fleet in the Community, who hold no role here yet. Empty for ' +
      'a reader who may not manage.',
  })
  candidates: GovernancePersonDto[];

  @ApiProperty({
    isArray: true,
    type: String,
    description: 'What every Officer here holds.',
  })
  officerCapabilities: string[];

  @ApiProperty({ type: [PersonalCapabilityDto] })
  personal: PersonalCapabilityDto[];

  @ApiProperty({
    type: [DelegableCapabilityDto],
    description: 'What may be delegated at this kind of scope.',
  })
  delegable: DelegableCapabilityDto[];
}

/** Gives somebody a role label. */
export class AssignScopeRoleDto {
  @ApiProperty({ description: 'Who.' })
  @IsUUID()
  readonly userId: string;

  @ApiProperty({ enum: APPOINTABLE_ROLES })
  @IsIn(APPOINTABLE_ROLES)
  readonly role: AppointableRole;

  @ApiPropertyOptional({ description: 'Why, for the record. Optional.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_GOVERNANCE_REASON_LENGTH)
  readonly reason?: string;
}

/** A reason that has to be given. */
export class GovernanceReasonDto {
  @ApiProperty({ description: 'Why, for the record. Required.' })
  @IsString()
  @MaxLength(MAX_GOVERNANCE_REASON_LENGTH)
  readonly reason: string;
}

/** A reason that may be given. */
export class OptionalGovernanceReasonDto {
  @ApiPropertyOptional({ description: 'Why, for the record.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_GOVERNANCE_REASON_LENGTH)
  readonly reason?: string;
}

/** Sets what every Officer here holds. */
export class SetOfficerCapabilitiesDto extends OptionalGovernanceReasonDto {
  @ApiProperty({
    isArray: true,
    type: String,
    description:
      'Every capability Officers here should hold. A reason is required ' +
      'when this takes any away.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  readonly capabilities: string[];
}

/** Grants or denies one capability to one person here. */
export class SetPersonalCapabilityDto extends OptionalGovernanceReasonDto {
  @ApiProperty({ description: 'Who.' })
  @IsUUID()
  readonly userId: string;

  @ApiProperty({ description: 'The capability code.' })
  @IsString()
  @MaxLength(100)
  readonly capability: string;

  @ApiProperty({
    enum: ScopeCapabilityEffect,
    description: 'A denial needs a reason, and beats every grant.',
  })
  @IsEnum(ScopeCapabilityEffect)
  readonly effect: ScopeCapabilityEffect;
}

/** One entry in a scope's governance history. */
export class ScopeGovernanceActionDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ enum: ScopeGovernanceActionKind })
  action: ScopeGovernanceActionKind;

  @ApiPropertyOptional({
    description: 'Who made it, by username, or null.',
    nullable: true,
  })
  actorName: string | null;

  @ApiProperty({
    description: 'Whether a site administrator made it in a dispute.',
  })
  asSiteAdmin: boolean;

  @ApiPropertyOptional({
    description: 'Who it was about, by username, or null.',
    nullable: true,
  })
  subjectName: string | null;

  @ApiPropertyOptional({ enum: FleetScopeRole, nullable: true })
  role: FleetScopeRole | null;

  @ApiPropertyOptional({ nullable: true })
  capability: string | null;

  @ApiPropertyOptional({ enum: ScopeCapabilityEffect, nullable: true })
  clearedEffect: ScopeCapabilityEffect | null;

  @ApiPropertyOptional({ nullable: true })
  reason: string | null;

  @ApiProperty({
    description:
      'Whether the system recorded it, as a consequence of another change: ' +
      'a role or grant ended by a closure, a departure or a hand-over ' +
      '(FC-039).',
  })
  automatic: boolean;

  @ApiProperty({ description: 'When it happened.' })
  createdAt: Date;
}
