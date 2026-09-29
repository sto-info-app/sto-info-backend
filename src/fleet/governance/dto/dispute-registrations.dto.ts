import { ApiProperty } from '@nestjs/swagger';

import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { CommunityDisputeViewDto } from './ownership-transfer.dto';
import { GovernancePersonDto } from './scope-governance.dto';

/**
 * One registration of an in-game name on STO Info, as a site admin sees it
 * in a dispute (FC-036). Where it came from, never who leads it in the game:
 * STO Info cannot know that.
 */
export class DisputeRegistrationDto {
  @ApiProperty({ enum: [FleetScopeKind.FLEET, FleetScopeKind.ARMADA] })
  kind: FleetScopeKind;

  @ApiProperty() id: string;

  @ApiProperty({ description: 'Its exact in-game name, as registered.' })
  exactGameName: string;

  @ApiProperty() platformName: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Null for a Fleet observed but never registered.',
  })
  communityId: string | null;

  @ApiProperty({ nullable: true, type: String }) communityName: string | null;

  @ApiProperty({
    nullable: true,
    type: GovernancePersonDto,
    description: 'The Owner of the Community that registered it.',
  })
  communityOwner: GovernancePersonDto | null;

  @ApiProperty({ enum: FleetAudience, nullable: true })
  visibility: FleetAudience | null;

  @ApiProperty({ enum: FleetScopeStatus }) status: FleetScopeStatus;

  @ApiProperty({ description: 'When it was registered on STO Info.' })
  registeredAt: Date;

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'The last roster import it took, for a Fleet.',
  })
  lastImportAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Its approved members, for a Fleet.',
  })
  memberCount: number | null;
}

/** A Fleet or Armada of the disputed Community, and every other registration of its name. */
export class DisputeScopeDto extends DisputeRegistrationDto {
  @ApiProperty({
    type: [DisputeRegistrationDto],
    description:
      'Every other registration of the same exact name on the same platform, private ones included, freshest first.',
  })
  duplicates: DisputeRegistrationDto[];
}

/** What a site admin's dispute page needs (FC-022, FC-036). */
export class CommunityDisputeDto extends CommunityDisputeViewDto {
  @ApiProperty({
    type: [DisputeScopeDto],
    description: 'Its Fleets, then its Armadas, each with its duplicates.',
  })
  scopes: DisputeScopeDto[];
}
