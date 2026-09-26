import { ApiProperty } from '@nestjs/swagger';

import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

import { CharacterFleetMembershipSource } from '../enums/character-fleet-membership-source.enum';
import { CharacterFleetProposalState } from '../enums/character-fleet-proposal-status.enum';
import { FleetAudience } from '../enums/fleet-audience.enum';

/**
 * The Fleet named by a personal membership or a proposal.
 *
 * Enough to recognise it and to link to it, and nothing more. This shape is
 * returned to somebody reading their own Character, which is not a reason to
 * hand them a Fleet's recruitment state, its allegiance or its artwork — those
 * belong to the Fleet's own page, where the audience rules decide who sees
 * them. Its name, platform and address are what the sentence "this Character
 * is in that Fleet" needs to make sense.
 */
export class CharacterFleetSummaryDto {
  @ApiProperty({ description: 'The Fleet record.' })
  id: string;

  @ApiProperty({ description: 'Its name, exactly as recorded.' })
  exactGameName: string;

  @ApiProperty({ description: 'Its URL segment.' })
  slug: string;

  @ApiProperty({ description: 'The platform, as the catalogue names it.' })
  platformName: string;

  @ApiProperty({ description: 'The platform, as an address segment.' })
  platformSegment: string;

  @ApiProperty({
    description: 'The Community holding it, or null when standalone.',
    nullable: true,
  })
  communityName: string | null;

  @ApiProperty({
    description: 'That Community’s URL segment, or null when standalone.',
    nullable: true,
  })
  communitySlug: string | null;
}

/**
 * One entry in a Character's own Fleet history.
 *
 * `source` is on it deliberately. A membership somebody typed in and one they
 * confirmed from a Fleet's roster are worth different amounts, and a history
 * that presents them identically invites the reader to treat their own guess
 * as evidence.
 */
export class CharacterFleetMembershipDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Character it is about.' })
  characterId: string;

  @ApiProperty({ type: CharacterFleetSummaryDto })
  fleet: CharacterFleetSummaryDto;

  @ApiProperty({ description: 'When the membership began.' })
  validFrom: Date;

  @ApiProperty({
    description: 'When it ended, or null while current.',
    nullable: true,
  })
  validTo: Date | null;

  @ApiProperty({
    enum: CharacterFleetMembershipSource,
    description: 'What established it.',
  })
  source: CharacterFleetMembershipSource;

  @ApiProperty({
    enum: FleetAudience,
    description: 'Who may see it. Private unless the owner has widened it.',
  })
  visibility: FleetAudience;

  @ApiProperty({
    description: 'The proposal it was accepted from, if any.',
    nullable: true,
  })
  proposalId: string | null;

  @ApiProperty({ description: 'When it was recorded here.' })
  recordedAt: Date;
}

/**
 * A suggestion awaiting the owner's answer.
 *
 * `state` rather than the stored status, because the one outcome nobody chose
 * is expiry and a client should not have to compare a date to find out. The
 * deadline is returned alongside it so the reader can be told how long they
 * have rather than only that they have run out.
 */
export class CharacterFleetProposalDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Character it is about.' })
  characterId: string;

  @ApiProperty({ type: CharacterFleetSummaryDto })
  fleet: CharacterFleetSummaryDto;

  @ApiProperty({
    enum: CharacterFleetProposalState,
    description: 'Where it stands, expiry included.',
  })
  state: CharacterFleetProposalState;

  @ApiProperty({
    description: 'When the evidence says the association was true.',
    nullable: true,
  })
  observedAt: Date | null;

  @ApiProperty({ description: 'When it was raised.' })
  raisedAt: Date;

  @ApiProperty({ description: 'When it stops being answerable.' })
  expiresAt: Date;

  @ApiProperty({
    description: 'When the owner answered, or null while unanswered.',
    nullable: true,
  })
  answeredAt: Date | null;

  @ApiProperty({
    description:
      'Whether an accepted application to the Fleet raised it, rather than ' +
      'roster evidence (FC-021).',
  })
  fromApplication: boolean;
}

/**
 * Recording that a Character is, or was, in a Fleet.
 *
 * `validTo` is what separates "I am in this Fleet" from "I was in this Fleet
 * until then", and it is the only difference between the two requests. Leaving
 * it out opens the current membership and closes whichever one was open.
 */
export class RecordCharacterFleetDto {
  @ApiProperty({ description: 'The Fleet record being named.' })
  @IsUUID()
  readonly fleetId: string;

  @ApiProperty({ description: 'When the association began.' })
  @IsDateString()
  readonly validFrom: string;

  @ApiProperty({
    description: 'When it ended. Leave it out for a current membership.',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf(dto => dto.validTo !== null)
  @IsDateString()
  readonly validTo?: string | null;

  @ApiProperty({
    enum: FleetAudience,
    description: 'Who may see it. Private if not given.',
    required: false,
  })
  @IsOptional()
  @IsEnum(FleetAudience)
  readonly visibility?: FleetAudience;
}

/**
 * Closing the open membership, because the Character has left.
 *
 * The instant is optional and means now when it is left out, which is the
 * ordinary case: somebody recording that they have left a Fleet has almost
 * always just left it. Giving one is for the person catching up on a departure
 * from last year.
 */
export class LeaveCharacterFleetDto {
  @ApiProperty({
    description: 'When it ended. Now, if not given.',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  readonly validTo?: string;
}

/** Changing who may see one membership. */
export class UpdateCharacterFleetVisibilityDto {
  @ApiProperty({ enum: FleetAudience, description: 'The audience it gets.' })
  @IsEnum(FleetAudience)
  readonly visibility: FleetAudience;
}

/**
 * Accepting a proposal.
 *
 * The audience is settled here rather than defaulted and corrected afterwards,
 * because the membership an acceptance opens is visible from the instant it
 * exists and "private unless you said otherwise" has to hold at that instant
 * rather than a request later.
 */
export class AcceptCharacterFleetProposalDto {
  @ApiProperty({
    enum: FleetAudience,
    description: 'Who may see the membership it opens. Private if not given.',
    required: false,
  })
  @IsOptional()
  @IsEnum(FleetAudience)
  readonly visibility?: FleetAudience;
}
