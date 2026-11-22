import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

import { GovernancePersonDto } from '../governance/dto/scope-governance.dto';
import { ROSTER_ERASURE_REASON } from './roster-erasure.constants';

/**
 * Trims a string, leaving anything else for the validators to refuse.
 *
 * @param value - What was sent.
 * @returns It, trimmed where it is text.
 */
function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Whose roster data (FC-038): a Character name and @handle. */
export class RosterErasureTargetDto {
  @ApiProperty({
    maxLength: 255,
    description:
      'The Character name exactly as a roster writes it. Never trimmed: a ' +
      'leading space is a real difference in this game.',
  })
  @IsString()
  @Length(1, 255)
  readonly characterName: string;

  @ApiProperty({ maxLength: 255, example: '@handle' })
  @Transform(trimmed)
  @IsString()
  @Length(1, 255)
  readonly accountHandle: string;
}

/** A verified erasure, with why (FC-038). */
export class RosterErasureRequestDto extends RosterErasureTargetDto {
  @ApiProperty({
    minLength: ROSTER_ERASURE_REASON.min,
    maxLength: ROSTER_ERASURE_REASON.max,
    description:
      'Why, and how the request was verified. Never the name or handle.',
  })
  @Transform(trimmed)
  @IsString()
  @Length(ROSTER_ERASURE_REASON.min, ROSTER_ERASURE_REASON.max)
  readonly reason: string;
}

/** One Fleet whose roster names somebody. */
export class RosterErasureFleetDto {
  @ApiProperty() fleetId: string;

  @ApiProperty() fleetName: string;

  @ApiProperty({ nullable: true, type: String })
  communityName: string | null;

  @ApiProperty({ description: 'How many roster rows name them.' })
  rows: number;
}

/** What an erasure would touch, before it is made. */
export class RosterErasurePreviewDto {
  @ApiProperty({ description: 'Whether they are already erased.' })
  alreadyErased: boolean;

  @ApiProperty({ description: 'Roster rows naming them, in every Fleet.' })
  rows: number;

  @ApiProperty({ type: [RosterErasureFleetDto] })
  fleets: RosterErasureFleetDto[];
}

/** An erasure, as the site admins' list shows it. Never the name. */
export class RosterErasureDto {
  @ApiProperty() id: string;

  @ApiProperty({ description: 'The handle that replaced theirs.' })
  pseudonym: string;

  @ApiProperty() reason: string;

  @ApiProperty({ nullable: true, type: GovernancePersonDto })
  admin: GovernancePersonDto | null;

  @ApiProperty({
    description: 'Re-applied from the ledger after a restore.',
  })
  replayed: boolean;

  @ApiProperty({ description: 'Roster rows anonymised.' })
  observations: number;

  @ApiProperty({ description: 'Identity aliases anonymised.' })
  aliases: number;

  @ApiProperty({ description: 'Fleets replayed.' })
  fleets: number;

  @ApiProperty() createdAt: Date;
}

/** An erasure just made, with what became of the files that named them. */
export class RosterErasureResultDto extends RosterErasureDto {
  @ApiProperty({ description: 'Stored roster files deleted now.' })
  filesDeleted: number;

  @ApiProperty({
    description:
      'Files whose bytes could not be deleted now; tonight’s retention run ' +
      'deletes them.',
  })
  filesPending: number;
}
